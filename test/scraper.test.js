import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parsePrice, findPrices } from '../scraper/lib/price.js';
import { productKey } from '../scraper/lib/match.js';
import { findProductsInJson } from '../scraper/adapters/browser.js';
import { startMock } from './mock-server.js';

const run = promisify(execFile);
let mock;
before(async () => { mock = await startMock(); });
after(() => mock.server.close());

test('parses the price formats the stores use', () => {
  assert.equal(parsePrice('39,990 L'), 39990);
  assert.equal(parsePrice('48.990L'), 48990);
  assert.equal(parsePrice('43 990 Lekë'), 43990);
  assert.equal(parsePrice('109.900 Lekë'), 109900);
  assert.equal(parsePrice('39990.00'), 39990);
  assert.equal(parsePrice(79990), 79990);
  assert.deepEqual(findPrices('Kurse 25.000L 54.990L 29.990L952 lekë/muaj'), [25000, 54990, 29990]);
});

test('the same TV from different stores gets the same key', () => {
  const same = (names) => assert.equal(new Set(names.map((n) => productKey(n).key)).size, 1, names.join(' / '));
  same(['TV SAMSUNG LED UE55U8072FUXXH', 'Samsung 55&#8243; Crystal UHD U8072F 4K Smart TV (2025)', 'Televizor LED Samsung 55" 4K UE55U8072FUXXH']);
  same(['TELEVIZOR LG 55UR73006LA', 'TV 55UR73006LA.AEU', 'Televizor LED LG 55" 4K 55UR73006LA']);
  same(['TV LED PHILIPS 65PUS7000/12', 'Televizor LED Philips 65" 4K 65PUS7000/12']);
  same(['Samsung 65" QLED Q7F 4K Samsung Vision AI Smart TV (2025)', 'TV SAMSUNG QLED QE65Q7FAAUXXH']);
  assert.notEqual(productKey('TV SAMSUNG UE55U8072FUXXH').key, productKey('TV SAMSUNG UE65U8072FUXXH').key);
  assert.notEqual(productKey('TV SAMSUNG QE55Q7FAAUXXH').key, productKey('TV SAMSUNG QE55QN80FAUXXH').key);
});

test('finds products inside arbitrary JSON payloads', () => {
  const found = findProductsInJson({ data: { list: [
    { ProductName: 'TV A 55UR73006LA', DiscountPrice: 34990, RegularPrice: 52990, Url: '/p/1' },
    { ProductName: 'TV B 65UR73006LA', DiscountPrice: 54990, RegularPrice: 72990, Url: '/p/2' },
  ] } }, 'https://x.al');
  assert.equal(found.length, 2);
  assert.equal(found[0].price, 34990);
  assert.equal(found[0].oldPrice, 52990);
  assert.equal(found[0].url, 'https://x.al/p/1');
});

test('end to end: scrapes all five store types and picks the best offer', { timeout: 120000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'krahaso-'));
  const cfg = path.join(dir, 'stores.mjs');
  const b = mock.base;
  await fs.writeFile(cfg, `export const stores = {
    neptun: { name: 'Neptun', homepage: '${b}/neptun', type: 'neptun', productLinkPattern: '/categories/.+', categories: { tv: ['${b}/neptun/te_gjithe_tv.nspx'] } },
    globe: { name: 'Globe', homepage: '${b}/globe', type: 'browser', productLinkPattern: '/products/\\\\d+', pageParam: 'page', categories: { tv: ['${b}/globe/products?categoryId=3048'] } },
    shpresa: { name: 'Shpresa', homepage: '${b}/shpresa', type: 'woocommerce', categories: { tv: [{ slug: 'televizor', url: '${b}/shpresa/cat/' }] } },
    ozone: { name: 'Ozone', homepage: '${b}/ozone', type: 'prestashop', categories: { tv: ['${b}/ozone/32-tv'] } },
    aza: { name: 'AZA', homepage: '${b}/aza', type: 'opencart', categories: { tv: ['${b}/aza/tvs'] } },
  };`);
  const env = { ...process.env, KRAHASO_STORES: cfg, KRAHASO_DATA: dir };
  await run(process.execPath, ['scraper/index.js'], { env, cwd: path.resolve('.') });

  const data = JSON.parse(await fs.readFile(path.join(dir, 'tv.json'), 'utf8'));
  const s55 = data.products.find((p) => p.key === 'samsung|55|u8072f');
  assert.ok(s55, 'Samsung 55 U8072F grouped');
  assert.deepEqual(s55.offers.map((o) => o.store).sort(), ['aza', 'globe', 'neptun', 'ozone', 'shpresa']);
  assert.equal(s55.bestStore, 'neptun');
  assert.equal(s55.bestPrice, 35990);
  assert.equal(s55.maxPrice, 39990);

  const tcl = data.products.find((p) => p.key === 'tcl|55t69c');
  assert.equal(tcl?.offers[0].price, 27999, 'Neptun page-2 product fetched through LoadProductsForCategory');
  assert.ok(tcl.offers[0].url.endsWith('/categories/te-gjithe-tv/TV-TCL-QLED-55T69C-TV6047'));

  const lg = data.products.find((p) => p.key === 'lg|55ur73006la');
  assert.deepEqual(lg.offers.map((o) => o.store).sort(), ['aza', 'globe', 'neptun']);
  assert.equal(lg.bestPrice, 30990);

  const q7f = data.products.find((p) => p.key === 'samsung|65|q7f');
  assert.equal(q7f.offers.find((o) => o.store === 'shpresa').price, 57990, 'minor units handled');
  assert.equal(q7f.bestStore, 'shpresa', 'out-of-stock Ozone offer is not the best');

  assert.ok(!data.products.some((p) => /MBAJTESE/.test(p.title)), 'wall mount filtered out');
  assert.ok(Object.values(data.stores).every((s) => s.ok));

  // second run with one store blocked keeps its last prices, marked stale
  await fs.writeFile(cfg, (await fs.readFile(cfg, 'utf8')).replace(`${b}/ozone/32-tv`, `${b}/blocked/32-tv`).replace("type: 'prestashop'", "type: 'prestashop', productLinkPattern: 'zzz'"));
  await run(process.execPath, ['scraper/index.js'], { env, cwd: path.resolve('.') });
  const data2 = JSON.parse(await fs.readFile(path.join(dir, 'tv.json'), 'utf8'));
  assert.equal(data2.stores.ozone.ok, false);
  const oz = data2.products.find((p) => p.key === 'samsung|55|u8072f').offers.find((o) => o.store === 'ozone');
  assert.equal(oz.stale, true);
  assert.equal(oz.price, 38990);

  const hist = JSON.parse(await fs.readFile(path.join(dir, 'history-tv.json'), 'utf8'));
  assert.equal(hist['samsung|55|u8072f'].aza.length, 1, 'unchanged price not duplicated in history');
});

test('HTML fallbacks read standard WooCommerce and PrestaShop markup', async () => {
  const { parseWooHtml } = await import('../scraper/adapters/woocommerce.js');
  const { parsePrestaHtml } = await import('../scraper/adapters/prestashop.js');
  const woo = parseWooHtml(`<ul class="products">
    <li class="product"><a class="woocommerce-LoopProduct-link" href="/product/a/"><h2 class="woocommerce-loop-product__title">Samsung 65&#8243; QLED Q7F 4K</h2>
    <span class="price"><del><span class="woocommerce-Price-amount amount">69,990&nbsp;L</span></del> <ins><span class="woocommerce-Price-amount amount">57,990&nbsp;L</span></ins></span></a></li>
    <li class="product outofstock"><a href="/product/b/"><h2 class="woocommerce-loop-product__title">Xiaomi TV A 43 2026</h2><span class="price"><span class="amount">24,990 L</span></span></a></li>
  </ul>`, 'https://shpresa.al/x/');
  assert.equal(woo.length, 2);
  assert.deepEqual([woo[0].price, woo[0].oldPrice, woo[0].url], [57990, 69990, 'https://shpresa.al/product/a/']);
  assert.equal(woo[1].inStock, false);

  const ps = parsePrestaHtml(`<article class="product-miniature" data-id-product="2040">
    <h3 class="product-title"><a href="https://ozone.al/televizor-audio/2040-led-tv-elektra-50.html">LED TV ELEKTRA 50" ET-X50UHDD</a></h3>
    <div class="product-price-and-shipping"><span class="regular-price">39 990 Lekë</span><span class="price">21 999 Lekë</span></div></article>`, 'https://ozone.al/32-tv');
  assert.deepEqual([ps[0].price, ps[0].oldPrice], [21999, 39990]);
});
