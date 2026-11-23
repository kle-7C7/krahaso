// PrestaShop stores (Ozone). PrestaShop 1.7+/8 returns the listing as JSON when asked via XHR.
// Falls back to parsing the HTML product miniatures.
import * as cheerio from 'cheerio';
import { fetchText, absUrl, sleep } from '../lib/http.js';
import { parsePrice } from '../lib/price.js';
import { normalizeName } from '../lib/match.js';

export function parsePrestaJson(data) {
  return (data.products || []).map((p) => {
    const price = parsePrice(p.price_amount ?? p.price);
    const regular = parsePrice(p.regular_price_amount ?? p.regular_price);
    return {
      name: normalizeName(p.name),
      url: p.url || p.link,
      price,
      oldPrice: regular && price && regular > price ? regular : null,
      inStock: p.availability ? !/unavailable|out/i.test(p.availability) : Number(p.quantity ?? 1) > 0,
      image: p.cover?.bySize?.home_default?.url || p.cover?.medium?.url || null,
    };
  }).filter((p) => p.name && p.price);
}

export function parsePrestaHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('.product-miniature, article[data-id-product]').each((_, el) => {
    const $el = $(el);
    const a = $el.find('.product-title a, .product-name a, h3 a, h2 a').first();
    const name = normalizeName(a.text());
    const href = a.attr('href') || $el.find('a.thumbnail, a.product-thumbnail').attr('href');
    const price = parsePrice($el.find('.price, .product-price').first().attr('content') || $el.find('.price, .product-price').first().text());
    const oldPrice = parsePrice($el.find('.regular-price').first().text());
    if (!name || !href || !price) return;
    out.push({
      name,
      url: absUrl(href, baseUrl),
      price,
      oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
      inStock: !/nuk ka gjendje|out of stock|jashtë stok/i.test($el.text()),
      image: $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || null,
    });
  });
  return out;
}

export async function scrapePrestaShop(store, url, log) {
  const out = [];
  const seen = new Set();
  let mode = 'json';
  for (let page = 1; page <= 30; page++) {
    const u = new URL(url);
    u.searchParams.set('page', String(page));
    let items = [];
    if (mode === 'json') {
      try {
        u.searchParams.set('from-xhr', '');
        const text = await fetchText(u.toString(), {
          headers: { Accept: 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest' },
          retries: 1,
        });
        items = parsePrestaJson(JSON.parse(text));
        if (!items.length && page === 1) throw new Error('empty JSON');
      } catch (e) {
        if (page === 1) {
          log(`JSON listing unavailable (${e.message}), using HTML`);
          mode = 'html';
          u.searchParams.delete('from-xhr');
        } else break;
      }
    }
    if (mode === 'html') {
      u.searchParams.delete('from-xhr');
      const html = await fetchText(u.toString(), { retries: page === 1 ? 2 : 0 }).catch((e) => {
        if (page === 1) throw e;
        return '';
      });
      items = parsePrestaHtml(html, u.toString());
    }
    items = items.filter((i) => !seen.has(i.url) && seen.add(i.url));
    log(`page ${page} (${mode}): ${items.length} new`);
    if (!items.length) break;
    out.push(...items);
    await sleep(800);
  }
  return out;
}
