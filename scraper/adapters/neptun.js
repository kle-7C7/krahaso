// Neptun (neptun.al). Worked out from a recording of the live site (HAR file):
//
//  * The category page HTML carries the first 20 products as JSON in the
//    `data-categorydetails` attribute of <div id="angularApp">, plus the search settings
//    in `data-initialSearchModel` ({"CategoryId":276,"ItemsPerPage":20,"CurrentPage":1,...}).
//  * Further pages come from  POST /NeptunCategories/LoadProductsForCategory
//    with body {"model": <searchModel with CurrentPage / ItemsPerPage changed>}
//    and the answer {"Batch":{"Items":[...],"Config":{"TotalItems":191,"ItemsPerPage":..}}}.
//  * Product link = /categories/<Category.Url>/<Url>
//
// If any of this stops working, index.js falls back to the headless browser automatically.
import { fetchText, sleep, UA } from '../lib/http.js';
import { normalizeName } from '../lib/match.js';

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function attr(html, name) {
  const m = html.match(new RegExp(`data-${name}="([^"]*)"`, 'i'));
  if (!m) return null;
  try {
    return JSON.parse(decode(m[1]));
  } catch {
    return null;
  }
}

export function neptunProduct(p, origin) {
  const regular = Number(p.RegularPrice) || null;
  const candidates = [p.ActualPrice, p.HasDiscount ? p.DiscountPrice : null, p.WebshopDiscountPrice, regular]
    .map(Number)
    .filter((n) => n > 0);
  const price = candidates.length ? Math.round(Math.min(...candidates)) : null;
  const catUrl = p.Category?.Url || 'te-gjithe-tv';
  return {
    // titles sometimes contain non-breaking spaces (shown as "?" in some exports)
    name: normalizeName(String(p.Title || '').replace(/[ ?]+/g, ' ')),
    url: `${origin}/categories/${catUrl}/${p.Url}`,
    price,
    oldPrice: regular && price && regular > price ? Math.round(regular) : null,
    inStock: p.Active !== false && (p.AvailableOnline !== false || p.AvailableWebshop !== false),
    image: p.Thumbnail ? `${origin}/${p.Thumbnail}` : null,
    code: p.ProductCode || null,
  };
}

export function parseNeptunPage(html, origin) {
  const details = attr(html, 'categorydetails');
  const searchModel = attr(html, 'initialSearchModel');
  return {
    products: (details?.Products || []).map((p) => neptunProduct(p, origin)).filter((p) => p.name && p.price),
    total: details?.NumberOfProducts ?? null,
    searchModel,
  };
}

export async function scrapeNeptun(store, url, log) {
  const origin = (store.homepage || new URL(url).origin).replace(/\/$/, '');
  const html = await fetchText(url);
  const first = parseNeptunPage(html, origin);
  if (!first.searchModel) throw new Error('Neptun page has no data-initialSearchModel (layout changed?)');
  log(`page HTML: ${first.products.length} of ${first.total ?? '?'} products`);

  const byUrl = new Map(first.products.map((p) => [p.url, p]));
  const perPage = 100;
  let apiOk = false;
  for (let page = 1; page <= 30; page++) {
    const model = { ...first.searchModel, ItemsPerPage: perPage, CurrentPage: page };
    let data;
    try {
      const res = await fetch(`${origin}/NeptunCategories/LoadProductsForCategory`, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Accept: 'application/json, text/plain, */*',
          'Content-Type': 'application/json;charset=utf-8',
          'from-angular': 'true',
          Origin: origin,
          Referer: url,
        },
        body: JSON.stringify({ model }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
    } catch (e) {
      log(`LoadProductsForCategory page ${page} failed: ${e.message}`);
      break;
    }
    apiOk = true;
    const items = (data?.Batch?.Items || []).map((p) => neptunProduct(p, origin)).filter((p) => p.name && p.price);
    let added = 0;
    for (const it of items) if (!byUrl.has(it.url)) { byUrl.set(it.url, it); added++; }
    const total = data?.Batch?.Config?.TotalItems ?? first.total;
    log(`API page ${page}: ${items.length} items (${added} new), ${byUrl.size}/${total ?? '?'}`);
    if (!items.length || (total && byUrl.size >= total) || items.length < perPage) break;
    await sleep(800);
  }

  // If the API is blocked and we only have page 1, signal it so the browser fallback runs.
  if (!apiOk && first.total && byUrl.size < first.total) {
    throw new Error(`only ${byUrl.size} of ${first.total} products (API blocked?)`);
  }
  return [...byUrl.values()];
}
