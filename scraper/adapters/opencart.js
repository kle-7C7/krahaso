// OpenCart stores (AZA Electronics). Plain HTML listing with ?limit=100&page=N.
import * as cheerio from 'cheerio';
import { fetchText, absUrl, sleep } from '../lib/http.js';
import { parsePrice } from '../lib/price.js';
import { normalizeName } from '../lib/match.js';

export function parseOpenCartHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('.product-thumb, .product-layout, .product-grid-item, .product-list-item').each((_, el) => {
    const $el = $(el);
    // skip wrappers that contain a nested product card (avoid double counting)
    if ($el.find('.product-thumb').length && !$el.is('.product-thumb')) return;
    const a = $el.find('.name a, h4 a, .caption a, .product-name a').first();
    const name = normalizeName(a.text() || $el.find('img').first().attr('alt'));
    const href = a.attr('href');
    const priceNew = $el.find('.price-new').first().text();
    const priceOld = $el.find('.price-old').first().text();
    const priceAny = $el.find('.price-normal, .price').first().clone().children('.price-old, .price-tax').remove().end().text();
    const price = parsePrice(priceNew || priceAny);
    if (!name || !href || !price) return;
    const oldPrice = parsePrice(priceOld);
    out.push({
      name,
      url: absUrl(href, baseUrl),
      price,
      oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
      inStock: !/out of sto|nuk ka gjendje|jashte stok/i.test($el.text()),
      image: $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || null,
    });
  });
  return out;
}

export async function scrapeOpenCart(store, url, log) {
  const out = [];
  const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const u = new URL(url);
    u.searchParams.set('limit', '100');
    u.searchParams.set('page', String(page));
    const html = await fetchText(u.toString(), { retries: page === 1 ? 2 : 1 });
    const items = parseOpenCartHtml(html, u.toString()).filter((i) => !seen.has(i.url) && seen.add(i.url));
    log(`page ${page}: ${items.length} new`);
    if (!items.length) break;
    out.push(...items);
    await sleep(800);
  }
  return out;
}
