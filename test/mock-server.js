// A local fake of the five store platforms, using each platform's standard markup/API shape.
// Used by the tests so the scraper can be exercised end to end without hitting real stores.
import http from 'node:http';
import fs from 'node:fs';

const aza = (page) => page > 1 ? '<div class="row"></div>' : `
<div class="main-products product-grid">
 <div class="product-layout"><div class="product-thumb">
  <div class="image"><a href="/tvs/televizor-lg-55ur73006la2.html"><img src="/img/lg.jpg" alt="TELEVIZOR LG 55UR73006LA"></a></div>
  <div class="caption"><div class="name"><a href="/tvs/televizor-lg-55ur73006la2.html">TELEVIZOR LG 55UR73006LA</a></div>
  <div class="price"><span class="price-new">30,990Lek</span> <span class="price-old">44,990Lek</span></div></div>
 </div></div>
 <div class="product-layout"><div class="product-thumb">
  <div class="caption"><div class="name"><a href="/tvs/tv-led-samsung-ue55u8072fuxxh2.html">TV LED SAMSUNG UE55U8072FUXXH</a></div>
  <div class="price"><span class="price-new">36,990Lek</span> <span class="price-old">59,990Lek</span></div></div>
 </div></div>
 <div class="product-layout"><div class="product-thumb">
  <div class="caption"><div class="name"><a href="/tvs/mbajtese.html">MBAJTESE TV SENCOR ADJUSTABLE SHT B362 32-55 INCH</a></div>
  <div class="price"><span class="price-new">1,690Lek</span></div></div>
 </div></div>
</div>`;

const shpresa = [
  { name: 'Samsung 55&#8243; Crystal UHD U8072F 4K Smart TV (2025)', permalink: 'https://shpresa.al/product/samsung-55-crystal-uhd-u8072f-4k-smart-tv-2025/',
    prices: { price: '39990', regular_price: '39990', sale_price: '39990', currency_minor_unit: 0 }, is_in_stock: true, images: [] },
  { name: 'Samsung 65&#8243; QLED Q7F 4K Samsung Vision AI Smart TV (2025)', permalink: 'https://shpresa.al/product/samsung-65-qled-q7f/',
    prices: { price: '5799000', regular_price: '6999000', currency_minor_unit: 2 }, is_in_stock: true, images: [] },
];

const ozone = (page) => ({
  products: page > 1 ? [] : [
    { name: 'LED TV SAMSUNG 55" UE55U8072FUXXH', url: 'https://ozone.al/televizor-audio/1-led-tv-samsung-55.html', price_amount: 38990, regular_price_amount: 49990, availability: 'available' },
    { name: 'QLED TV SAMSUNG 65" QE65Q7FAAUXXH', url: 'https://ozone.al/televizor-audio/2-qled.html', price_amount: 62990, regular_price_amount: 62990, availability: 'unavailable' },
  ],
});

// Neptun: first products embedded as JSON in data-categorydetails, more via POST LoadProductsForCategory.
// Built from a real Neptun product record (test/fixtures/neptun-product.json).
const tpl = JSON.parse(fs.readFileSync(new URL('./fixtures/neptun-product.json', import.meta.url), 'utf8'));
const np = (Title, Url, RegularPrice, DiscountPrice) => ({ ...tpl, Title, Url, RegularPrice, DiscountPrice, ActualPrice: DiscountPrice, HasDiscount: true });
const neptunAll = [
  np('TV SAMSUNG LED UE55U8072FUXXH', 'TV-SAMSUNG-LED-UE55U8072FUXXH-TV5600', 59990, 35990),
  np('TV LG LED 55UR73006LA.AEU', 'TV-LG-55UR73006LA-TV5601', 52990, 34990),
  np('TV TCL QLED 55T69C', 'TV-TCL-QLED-55T69C-TV6047', 41999, 27999),
];
const esc = (o) => JSON.stringify(o).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
const neptunPage = `<!doctype html><body><div ng-controller="shopMainController" id="angularApp"
  data-categorydetails="${esc({ Products: neptunAll.slice(0, 2), NumberOfProducts: 3, Id: 276 })}"
  data-initialSearchModel="${esc({ CategoryId: 276, Sort: 4, ItemsPerPage: 20, CurrentPage: 1 })}"></div></body>`;

// JS-rendered store with ?page=N (like Globe).
const globePage = (page) => {
  const data = page === 1
    ? [{ id: 101, n: 'Televizor LED Samsung 55" 4K UE55U8072FUXXH', p: 37900, o: 59900 }]
    : page === 2 ? [{ id: 102, n: 'Televizor LED LG 55" 4K 55UR73006LA', p: 33900, o: 0 }] : [];
  return `<!doctype html><body><main id="m"></main><script>
  const d=${JSON.stringify(data)};
  setTimeout(()=>{document.getElementById('m').innerHTML=d.map(x=>'<div class="card"><a href="/products/'+x.id+'" title="'+x.n.replace(/"/g,'&quot;')+'">'+x.n+'</a>'+(x.o?'<del>'+x.o.toLocaleString('en-US')+' L</del>':'')+'<b>'+x.p.toLocaleString('en-US')+' L</b></div>').join('')},200);
  </script></body>`;
};

export function startMock() {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    const page = Number(u.searchParams.get('page') || 1);
    const send = (body, type = 'text/html') => { res.writeHead(200, { 'Content-Type': type + '; charset=utf-8' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (u.pathname === '/aza/tvs') return send(aza(page));
    if (u.pathname === '/shpresa/wp-json/wc/store/v1/products') return send(page > 1 ? [] : shpresa, 'application/json');
    if (u.pathname === '/ozone/32-tv') return u.searchParams.has('from-xhr') ? send(ozone(page), 'application/json') : send('<html></html>');
    if (u.pathname === '/neptun/te_gjithe_tv.nspx') return send(neptunPage);
    if (u.pathname === '/neptun/NeptunCategories/LoadProductsForCategory' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      return req.on('end', () => {
        const { model } = JSON.parse(body);
        if (req.headers['from-angular'] !== 'true' || model.CategoryId !== 276) { res.writeHead(400); return res.end(); }
        const items = neptunAll.slice((model.CurrentPage - 1) * model.ItemsPerPage, model.CurrentPage * model.ItemsPerPage);
        send({ Batch: { Items: items, Config: { TotalItems: neptunAll.length, ItemsPerPage: model.ItemsPerPage } } }, 'application/json');
      });
    }
    if (u.pathname === '/globe/products') return send(globePage(page));
    if (u.pathname === '/blocked/32-tv') { res.writeHead(403); return res.end('blocked'); }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(0, () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
