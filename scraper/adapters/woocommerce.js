// WooCommerce stores (Shpresa). Uses the public Store API, falls back to category HTML.
import * as cheerio from 'cheerio';
import { fetchJson, fetchText, absUrl, sleep } from '../lib/http.js';
import { parsePrice } from '../lib/price.js';
import { normalizeName } from '../lib/match.js';

export async function scrapeWooCommerce(store, source, log) {
  const origin = (store.apiBase || store.homepage).replace(/\/$/, '');
  try {
    const items = await viaStoreApi(origin, source.slug, log);
    if (items.length) return items;
  } catch (e) {
    log(`Store API failed (${e.message}), trying HTML`);
  }
  return viaHtml(source.url, log);
}

async function viaStoreApi(origin, slug, log) {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const url = `${origin}/wp-json/wc/store/v1/products?category=${encodeURIComponent(slug)}&per_page=100&page=${page}`;
    const data = await fetchJson(url);
    if (!Array.isArray(data) || !data.length) break;
    for (const p of data) {
      const unit = Number(p.prices?.currency_minor_unit ?? 0);
      const div = 10 ** unit;
      const price = Math.round(Number(p.prices?.price) / div) || null;
      const regular = Math.round(Number(p.prices?.regular_price) / div) || null;
      out.push({
        name: normalizeName(p.name),
        url: p.permalink,
        price,
        oldPrice: regular && price && regular > price ? regular : null,
        inStock: p.is_in_stock !== false,
        image: p.images?.[0]?.thumbnail || p.images?.[0]?.src || null,
      });
    }
    log(`Store API page ${page}: ${data.length}`);
    if (data.length < 100) break;
    await sleep(800);
  }
  return out;
}

export function parseWooHtml(html, baseUrl) {
  const $ = cheerio.load(html);
  const out = [];
  $('li.product, .product.type-product, .wd-product, .product-grid-item').each((_, el) => {
    const $el = $(el);
    const a = $el.find('.woocommerce-loop-product__title a, h2 a, h3 a, .wd-entities-title a, a.woocommerce-LoopProduct-link').first();
    const name = normalizeName($el.find('.woocommerce-loop-product__title, .wd-entities-title, h2, h3').first().text() || a.text());
    const href = a.attr('href') || $el.find('a[href*="/product/"]').first().attr('href');
    const sale = $el.find('.price ins .amount, .price ins').first().text();
    const old = $el.find('.price del .amount, .price del').first().text();
    const any = $el.find('.price .amount, .price').first().text();
    const price = parsePrice(sale || any);
    if (!name || !href || !price) return;
    const oldPrice = parsePrice(old);
    out.push({
      name,
      url: absUrl(href, baseUrl),
      price,
      oldPrice: oldPrice && oldPrice > price ? oldPrice : null,
      inStock: !$el.hasClass('outofstock') && !/shitur|out of stock|nuk ka/i.test($el.text()),
      image: $el.find('img').first().attr('data-src') || $el.find('img').first().attr('src') || null,
    });
  });
  return out;
}

async function viaHtml(url, log) {
  const out = [];
  for (let page = 1; page <= 30; page++) {
    const pageUrl = page === 1 ? url : `${url.replace(/\/$/, '')}/page/${page}/`;
    let html;
    try {
      html = await fetchText(pageUrl, { retries: page === 1 ? 2 : 0 });
    } catch (e) {
      if (page === 1) throw e;
      break;
    }
    const items = parseWooHtml(html, pageUrl);
    log(`HTML page ${page}: ${items.length}`);
    if (!items.length) break;
    out.push(...items);
    await sleep(800);
  }
  return out;
}
