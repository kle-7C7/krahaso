// Headless-browser scraping for stores that build their pages with JavaScript (Neptun, Globe),
// and the fallback for any store whose plain-HTML route fails (e.g. bot protection).
//
// Two independent ways of finding products, merged:
//   1. JSON sniffing: every JSON response the page loads is searched for arrays of
//      product-like objects (a name field + a price field).
//   2. DOM reading: links that match the store's product URL pattern are walked up to their
//      card element, and the name + Lek prices are read from the card text.
import { chromium } from 'playwright';
import { parsePrice } from '../lib/price.js';
import { normalizeName } from '../lib/match.js';
import { UA, absUrl, sleep } from '../lib/http.js';
import { neptunProduct } from './neptun.js';

let browserPromise = null;
export async function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
    // optional: use an already-installed Chrome instead of Playwright's bundled Chromium
    executablePath: process.env.CHROME_PATH || undefined,
  });
  return browserPromise;
}
export async function closeBrowser() {
  if (browserPromise) (await browserPromise).close().catch(() => {});
  browserPromise = null;
}

const NAME_KEYS = ['name', 'title', 'productName', 'ProductName', 'Name', 'Title', 'naziv', 'emri'];
const PRICE_KEYS = ['finalPrice', 'discountPrice', 'DiscountPrice', 'actualPrice', 'ActualPrice', 'salePrice',
  'specialPrice', 'price', 'Price', 'currentPrice', 'cmimi', 'priceWithDiscount', 'webPrice', 'WebPrice'];
const OLD_KEYS = ['regularPrice', 'RegularPrice', 'oldPrice', 'OldPrice', 'originalPrice', 'basePrice', 'listPrice', 'fullPrice'];
const URL_KEYS = ['url', 'Url', 'URL', 'link', 'permalink', 'slug', 'Slug', 'seoUrl', 'productUrl', 'href'];

function pick(obj, keys) {
  for (const k of keys) if (obj[k] != null && obj[k] !== '') return obj[k];
  return null;
}

// Recursively find product-like objects in any JSON payload.
export function findProductsInJson(json, baseUrl) {
  const found = [];
  const walk = (node, depth) => {
    if (!node || depth > 8) return;
    if (Array.isArray(node)) {
      const candidates = node.filter((o) => o && typeof o === 'object' && pick(o, NAME_KEYS) && pick(o, PRICE_KEYS) != null);
      if (candidates.length >= 2) {
        for (const o of candidates) {
          let price = pick(o, PRICE_KEYS);
          if (typeof price === 'object') price = price.value ?? price.amount ?? price.final ?? null;
          const p = parsePrice(price);
          const old = parsePrice(pick(o, OLD_KEYS));
          const href = pick(o, URL_KEYS);
          if (!p) continue;
          found.push({
            name: normalizeName(String(pick(o, NAME_KEYS))),
            url: typeof href === 'string' ? absUrl(href, baseUrl) : null,
            price: p,
            oldPrice: old && old > p ? old : null,
            inStock: o.inStock ?? o.InStock ?? o.available ?? o.isAvailable ?? (o.stock != null ? Number(o.stock) > 0 : true),
            image: o.image || o.Image || o.thumbnail || o.imageUrl || null,
          });
        }
      }
      node.forEach((n) => walk(n, depth + 1));
    } else if (typeof node === 'object') {
      Object.values(node).forEach((v) => walk(v, depth + 1));
    }
  };
  walk(json, 0);
  return found;
}

// Runs inside the page.
export function readCardsInPage(linkPattern) {
  const re = new RegExp(linkPattern, 'i');
  // text of every text node joined with " | ", so prices in neighbouring elements never glue together
  const textOf = (el) => {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts = [];
    while (w.nextNode()) {
      const p = w.currentNode.parentElement;
      if (p && /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName)) continue;
      const t = w.currentNode.nodeValue.trim();
      if (t) parts.push(t);
    }
    return parts.join(' | ');
  };
  const priceRe = /(?<![A-Za-z0-9.,])(\d{1,3}(?:[.,\s ]\d{3})+|\d{4,7})[\s|]*(?:LEK[ËE]?|L(?!ED|CD|CE)|ALL\b)/gi;
  const hasPrice = new RegExp(priceRe.source, 'i'); // non-global: .test() must not move lastIndex
  const toNum = (s) => parseInt(String(s).replace(/[^\d]/g, ''), 10);
  const results = [];
  const seenCards = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (!href || !re.test(href)) continue;
    let card = a;
    for (let i = 0; i < 6 && card.parentElement; i++) {
      if (hasPrice.test(textOf(card)) && card.querySelectorAll('a[href]').length < 25) break;
      card = card.parentElement;
    }
    if (seenCards.has(card)) continue;
    const text = textOf(card);
    const prices = [...text.matchAll(priceRe)].map((m) => toNum(m[1])).filter((n) => n >= 500);
    if (!prices.length) continue;
    seenCards.add(card);
    const heading = card.querySelector('h1,h2,h3,h4,h5,[class*="name" i],[class*="title" i]');
    const name = (a.getAttribute('title') || (heading && heading.innerText) || a.innerText || '').trim();
    if (name.length < 4) continue;
    // monthly instalments ("1.490 lekë/muaj") and savings ("Kurse 23.000L") are not the price
    const monthly = [...text.matchAll(/(\d[\d.,\s]*)[\s|]*lek\S*?[\s|]*\/[\s|]*muaj/gi)].map((m) => toNum(m[1]));
    const savings = [...text.matchAll(/kurse(?:ni)?:?[\s|]*(\d[\d.,\s]*)/gi)].map((m) => toNum(m[1]));
    const real = prices.filter((p) => !monthly.includes(p) && !savings.includes(p));
    if (!real.length) continue;
    const img = card.querySelector('img');
    results.push({
      name: name.split('\n')[0],
      url: new URL(href, location.href).toString(),
      price: Math.min(...real),
      oldPrice: real.length > 1 ? Math.max(...real) : null,
      inStock: !/nuk ka gjendje|out of stock|shitur|jashtë stok|ska stok/i.test(text),
      image: img ? img.currentSrc || img.src : null,
    });
  }
  return results;
}

async function autoScroll(page) {
  let lastHeight = 0;
  for (let i = 0; i < 25; i++) {
    const h = await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    });
    await sleep(900);
    // click "load more" style buttons if present
    const clicked = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button, a')].find((el) =>
        /^(shfaq|shiko|ngarko)\s+(më\s+)?(shumë|tjera)|load more|show more/i.test((el.innerText || '').trim()) && el.offsetParent);
      if (b) { b.click(); return true; }
      return false;
    });
    if (clicked) await sleep(1500);
    if (h === lastHeight && !clicked) break;
    lastHeight = h;
  }
}

export async function scrapeWithBrowser(store, url, log) {
  const browser = await getBrowser();
  const context = await browser.newContext({ userAgent: UA, locale: 'sq-AL', viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const sniffed = [];
  page.on('response', async (res) => {
    try {
      const ct = res.headers()['content-type'] || '';
      if (!ct.includes('json')) return;
      const json = await res.json();
      sniffed.push(...findProductsInJson(json, store.homepage));
    } catch {}
  });

  const dom = [];
  const visit = async (u) => {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await autoScroll(page);
    const cards = await page.evaluate(readCardsInPage, store.productLinkPattern || '.');
    dom.push(...cards);
    // Neptun keeps the current page's products as JSON on <div data-categorydetails>
    const embedded = await page.evaluate(() => {
      try { return JSON.parse(document.querySelector('[data-categorydetails]')?.getAttribute('data-categorydetails') || 'null')?.Products || []; }
      catch { return []; }
    });
    if (embedded.length) {
      const origin = store.homepage.replace(/\/$/, '');
      dom.push(...embedded.map((p) => neptunProduct(p, origin)).filter((p) => p.name && p.price));
    }
    return cards.length;
  };

  try {
    const first = await visit(url);
    log(`browser page 1: ${first} cards, ${sniffed.length} JSON items`);
    if (store.pageParam) {
      for (let p = 2; p <= 30; p++) {
        const u = new URL(url);
        u.searchParams.set(store.pageParam, String(p));
        const before = new Set(dom.map((d) => d.url));
        await visit(u.toString());
        const added = dom.filter((d) => !before.has(d.url)).length;
        log(`browser page ${p}: ${added} new`);
        if (!added) break;
      }
    }
  } finally {
    await context.close();
  }

  // Merge: DOM entries are authoritative (they come with real store URLs);
  // JSON entries fill in products the DOM pass missed.
  const byName = new Map();
  for (const it of [...dom, ...sniffed]) {
    const k = normalizeName(it.name).toLowerCase();
    if (!k || byName.has(k)) continue;
    byName.set(k, { ...it, name: normalizeName(it.name), url: it.url || url });
  }
  return [...byName.values()];
}
