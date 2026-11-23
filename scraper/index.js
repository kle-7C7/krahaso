#!/usr/bin/env node
// Scrapes every store for every category and writes the data the website reads:
//   public/data/index.json          categories + last update
//   public/data/<category>.json     grouped products with each store's offer
//   public/data/history-<category>.json   price history (one point per change)
//
// Usage: node scraper/index.js [--category tv] [--store aza]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { categories } from '../config/categories.js';
import { productKey } from './lib/match.js';
import { scrapeWooCommerce } from './adapters/woocommerce.js';
import { scrapeOpenCart } from './adapters/opencart.js';
import { scrapePrestaShop } from './adapters/prestashop.js';
import { scrapeWithBrowser, closeBrowser } from './adapters/browser.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = process.env.KRAHASO_DATA || path.join(ROOT, 'public', 'data');
// KRAHASO_STORES lets tests (or a second deployment) point at another store config file
const { stores } = await import(process.env.KRAHASO_STORES ? pathToFileURL(path.resolve(process.env.KRAHASO_STORES)).href : '../config/stores.js');
const HISTORY_DAYS = 365;

const args = process.argv.slice(2);
const argVal = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const onlyCategory = argVal('--category');
const onlyStore = argVal('--store');

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function loadAliases() {
  const a = await readJson(path.join(ROOT, 'config', 'aliases.json'), {});
  return { byUrl: a.byUrl || {}, byName: a.byName || {} };
}

async function scrapeSource(store, source, log) {
  const url = typeof source === 'string' ? source : source.url;
  const primary = {
    woocommerce: () => scrapeWooCommerce(store, source, log),
    opencart: () => scrapeOpenCart(store, url, log),
    prestashop: () => scrapePrestaShop(store, url, log),
    browser: () => scrapeWithBrowser(store, url, log),
  }[store.type];
  if (!primary) throw new Error(`Unknown store type ${store.type}`);
  try {
    const items = await primary();
    if (items.length || store.type === 'browser') return items;
    log('no products from primary method, trying headless browser');
  } catch (e) {
    if (store.type === 'browser') throw e;
    log(`primary method failed: ${e.message}; trying headless browser`);
  }
  return scrapeWithBrowser(store, url, log);
}

function keep(cat, item) {
  const up = item.name.toUpperCase();
  if (cat.exclude && cat.exclude.test(up)) return false;
  if (cat.include && !cat.include.test(up) && !item._key.model) return false;
  if (cat.minSize && item._key.size && item._key.size < cat.minSize) return false;
  return true;
}

function bestTitle(offers) {
  // prefer a name that states brand and size, then the most descriptive one
  return offers
    .map((o) => o.name)
    .sort((a, b) => score(b) - score(a))[0];
  function score(n) {
    return (/"|''|inch/i.test(n) ? 20 : 0) + Math.min(n.length, 80);
  }
}

async function runCategory(catId, aliases) {
  const cat = categories[catId];
  const file = path.join(DATA, `${catId}.json`);
  const prev = await readJson(file, { products: [], stores: {} });
  const prevOffersByStore = {};
  for (const p of prev.products || [])
    for (const o of p.offers) (prevOffersByStore[o.store] ||= []).push({ ...o, _prev: { key: p.key, brand: p.brand, size: p.size, model: p.model } });

  const now = new Date().toISOString();
  const storeStatus = { ...(prev.stores || {}) };
  const offers = [];

  for (const [storeId, store] of Object.entries(stores)) {
    const sources = store.categories?.[catId];
    if (!sources || (onlyStore && onlyStore !== storeId)) {
      // not scraped this run: carry over previous offers untouched
      offers.push(...(prevOffersByStore[storeId] || []).map(({ _prev, ...o }) => ({ ...o, _key: _prev })));
      continue;
    }
    const log = (m) => console.log(`[${catId}/${storeId}] ${m}`);
    try {
      let items = [];
      for (const src of sources) items.push(...(await scrapeSource(store, src, log)));
      const seen = new Set();
      items = items
        .map((i) => ({ ...i, _key: keyFor(i, aliases) }))
        .filter((i) => keep(cat, i))
        .filter((i) => !seen.has(i.url + i.name) && seen.add(i.url + i.name));
      if (!items.length) throw new Error('0 products found (page layout may have changed)');
      log(`${items.length} products`);
      for (const i of items)
        offers.push({ store: storeId, name: i.name, url: i.url, price: i.price, oldPrice: i.oldPrice || null,
          inStock: i.inStock !== false, image: i.image || null, seenAt: now, _key: i._key });
      storeStatus[storeId] = { name: store.name, homepage: store.homepage, ok: true, count: items.length, lastSuccess: now, lastAttempt: now };
    } catch (e) {
      log(`FAILED: ${e.message}`);
      // keep the last good offers so one blocked run doesn't empty the site; mark them stale
      const old = prevOffersByStore[storeId] || [];
      offers.push(...old.map(({ _prev, ...o }) => ({ ...o, stale: true, _key: _prev })));
      storeStatus[storeId] = { ...(storeStatus[storeId] || {}), name: store.name, homepage: store.homepage, ok: false,
        error: String(e.message).replace(/\u001b\[\d+m/g, '').split('\n')[0].slice(0, 200), lastAttempt: now };
    }
  }

  // group offers into products
  const groups = new Map();
  for (const o of offers) {
    const k = o._key;
    const g = groups.get(k.key) || { key: k.key, brand: k.brand || null, size: k.size || null, model: k.model || null, offers: [] };
    g.brand ||= k.brand || null;
    g.size ||= k.size || null;
    g.model ||= k.model || null;
    const { _key, ...offer } = o;
    const existing = g.offers.find((x) => x.store === offer.store);
    if (!existing) g.offers.push(offer);
    else if (offer.price < existing.price) Object.assign(existing, offer);
    groups.set(k.key, g);
  }

  const products = [...groups.values()].map((g) => {
    g.offers.sort((a, b) => (a.inStock === b.inStock ? a.price - b.price : a.inStock ? -1 : 1));
    const live = g.offers.filter((o) => o.inStock && !o.stale);
    const pool = live.length ? live : g.offers;
    const min = Math.min(...pool.map((o) => o.price));
    const max = Math.max(...pool.map((o) => o.price));
    const prevP = (prev.products || []).find((p) => p.key === g.key);
    return {
      ...g,
      title: bestTitle(g.offers),
      image: g.offers.find((o) => o.image)?.image || null,
      storeCount: new Set(g.offers.map((o) => o.store)).size,
      bestPrice: min,
      bestStore: pool.find((o) => o.price === min).store,
      maxPrice: max,
      spread: max - min,
      previousBest: prevP && prevP.bestPrice !== min ? prevP.bestPrice : prevP?.previousBest ?? null,
      firstSeen: prevP?.firstSeen || now,
    };
  });
  products.sort((a, b) => b.storeCount - a.storeCount || b.spread - a.spread || a.bestPrice - b.bestPrice);

  await fs.writeFile(file, JSON.stringify({ category: catId, label: cat.label, updatedAt: now, stores: storeStatus, products }, null, 1));
  await updateHistory(catId, products, now);
  console.log(`[${catId}] wrote ${products.length} products (${products.filter((p) => p.storeCount > 1).length} in 2+ stores)`);
  return { id: catId, label: cat.label, updatedAt: now, products: products.length };
}

function keyFor(item, aliases) {
  const forced = aliases.byUrl[item.url] || aliases.byName[item.name];
  const auto = productKey(item.name);
  return forced ? { ...auto, key: forced } : auto;
}

async function updateHistory(catId, products, now) {
  const file = path.join(DATA, `history-${catId}.json`);
  const hist = await readJson(file, {});
  const day = now.slice(0, 10);
  const cutoff = new Date(Date.now() - HISTORY_DAYS * 864e5).toISOString().slice(0, 10);
  for (const p of products) {
    for (const o of p.offers) {
      if (o.stale) continue;
      const series = ((hist[p.key] ||= {})[o.store] ||= []);
      const last = series[series.length - 1];
      if (!last || last[1] !== o.price) series.push([day, o.price]);
    }
  }
  for (const k of Object.keys(hist))
    for (const s of Object.keys(hist[k])) {
      const kept = hist[k][s].filter((pt, i, arr) => pt[0] >= cutoff || i === arr.length - 1);
      hist[k][s] = kept;
    }
  await fs.writeFile(file, JSON.stringify(hist));
}

async function main() {
  await fs.mkdir(DATA, { recursive: true });
  const aliases = await loadAliases();
  const index = await readJson(path.join(DATA, 'index.json'), { categories: [] });
  const results = [];
  try {
    for (const catId of Object.keys(categories)) {
      if (onlyCategory && onlyCategory !== catId) continue;
      results.push(await runCategory(catId, aliases));
    }
  } finally {
    await closeBrowser();
  }
  const merged = new Map(index.categories.map((c) => [c.id, c]));
  for (const r of results) merged.set(r.id, r);
  await fs.writeFile(
    path.join(DATA, 'index.json'),
    JSON.stringify({ updatedAt: new Date().toISOString(), stores: Object.fromEntries(Object.entries(stores).map(([id, s]) => [id, { name: s.name, homepage: s.homepage }])), categories: [...merged.values()] }, null, 1),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
