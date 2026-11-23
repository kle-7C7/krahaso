// A local fake of the five store platforms, using each platform's standard markup/API shape.
// Used by the tests so the scraper can be exercised end to end without hitting real stores.
import http from 'node:http';

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

// JS-rendered store: products arrive from a JSON API and are drawn by script (like Neptun).
const neptunPage = `<!doctype html><body><div id="app">Loading…</div><script>
fetch('/neptun/api/products').then(r=>r.json()).then(d=>{
  document.getElementById('app').innerHTML = d.items.map(p =>
    '<div class="product-card"><a href="/categories/tv/'+p.slug+'"><h3>'+p.title+'</h3></a>'+
    '<span class="old">'+p.RegularPrice.toLocaleString('de-DE')+'L</span> <span class="new">'+p.DiscountPrice.toLocaleString('de-DE')+'L</span>'+
    '<span>Kurse '+(p.RegularPrice-p.DiscountPrice).toLocaleString('de-DE')+'L</span><span>1.490 lekë/muaj</span></div>').join('');
});
</script></body>`;
const neptunApi = { items: [
  { title: 'TV SAMSUNG LED UE55U8072FUXXH', slug: 'TV-SAMSUNG-LED-UE55U8072FUXXH-TV5600', RegularPrice: 59990, DiscountPrice: 35990 },
  { title: 'TV 55UR73006LA.AEU', slug: 'TV-LG-55UR73006LA-TV5601', RegularPrice: 52990, DiscountPrice: 34990 },
] };

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
    if (u.pathname === '/neptun/api/products') return send(neptunApi, 'application/json');
    if (u.pathname === '/globe/products') return send(globePage(page));
    if (u.pathname === '/blocked/32-tv') { res.writeHead(403); return res.end('blocked'); }
    res.writeHead(404); res.end();
  });
  return new Promise((r) => server.listen(0, () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
