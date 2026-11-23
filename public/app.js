(() => {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => n == null ? '' : n.toLocaleString('de-DE') + ' L';
  const ago = (iso) => {
    if (!iso) return 'never';
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (m < 60) return `${Math.max(m, 1)} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return `${Math.round(h / 24)} days ago`;
  };
  const STORE_COLORS = { neptun: 'var(--neptun)', globe: 'var(--globe)', shpresa: 'var(--shpresa)', ozone: 'var(--ozone)', aza: 'var(--aza)' };

  const state = { index: null, cat: null, data: null };
  const controls = ['q', 'brand', 'size', 'sort', 'multi', 'stock'];

  function readHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    for (const id of controls) {
      if (!p.has(id)) continue;
      const el = $('#' + id);
      if (el.type === 'checkbox') el.checked = p.get(id) === '1';
      else el.value = p.get(id);
    }
    return p.get('cat');
  }
  function writeHash() {
    const p = new URLSearchParams();
    if (state.cat) p.set('cat', state.cat);
    for (const id of controls) {
      const el = $('#' + id);
      const v = el.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value;
      if (v && !(id === 'sort' && v === 'spread') && !(id === 'stock' && v === '0') && id !== 'multi') p.set(id, v);
      if (id === 'multi' && el.dataset.touched) p.set(id, v);
    }
    history.replaceState(null, '', '#' + p.toString());
  }

  async function load() {
    const wanted = readHash();
    try {
      state.index = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
    } catch {
      $('#list').innerHTML = '<p class="loading">No price data yet. Run <code>npm run scrape</code> first.</p>';
      return;
    }
    const cats = state.index.categories || [];
    const tabs = $('#tabs');
    tabs.innerHTML = '';
    tabs.hidden = cats.length < 2;
    for (const c of cats) {
      const b = document.createElement('button');
      b.textContent = c.label;
      b.setAttribute('role', 'tab');
      b.onclick = () => openCategory(c.id);
      b.dataset.id = c.id;
      tabs.append(b);
    }
    const names = Object.values(state.index.stores || {}).map((s) => s.name);
    if (names.length) $('#store-names').textContent = names.slice(0, -1).join(', ') + ' and ' + names.at(-1);
    openCategory(cats.find((c) => c.id === wanted)?.id || cats[0]?.id);
  }

  async function openCategory(id) {
    if (!id) return;
    state.cat = id;
    for (const b of $('#tabs').children) b.setAttribute('aria-selected', String(b.dataset.id === id));
    $('#list').innerHTML = '<p class="loading">Loading prices…</p>';
    state.data = await (await fetch(`data/${id}.json`, { cache: 'no-cache' })).json();
    const label = state.data.label || id;
    $('#headline').textContent = `Find the best ${label.replace(/s$/, '')} deal in Albania`;
    document.title = `${label} prices — Krahaso`;
    // with few cross-store matches (e.g. right after setup) show everything by default
    const multiCount = state.data.products.filter((p) => p.storeCount > 1).length;
    if (!new URLSearchParams(location.hash.slice(1)).has('multi')) $('#multi').checked = multiCount >= 5;
    renderStatus();
    fillBrands();
    render();
  }

  function renderStatus() {
    const box = $('#status');
    box.innerHTML = '';
    const upd = document.createElement('span');
    upd.textContent = `Updated ${ago(state.data.updatedAt)} ·`;
    box.append(upd);
    const storesMeta = state.index.stores || {};
    for (const [id, meta] of Object.entries(storesMeta)) {
      const s = state.data.stores?.[id];
      const a = document.createElement('a');
      a.className = 'chip';
      a.href = meta.homepage;
      a.target = '_blank';
      a.rel = 'noopener';
      const dot = document.createElement('span');
      dot.className = 'dot' + (!s || !s.lastSuccess ? ' none' : s.ok ? '' : ' stale');
      a.append(dot, document.createTextNode(`${meta.name}${s?.count ? ` · ${s.count}` : ''}`));
      a.title = !s ? 'Not checked yet'
        : s.ok ? `Checked ${ago(s.lastSuccess)}`
        : `Last check failed (${s.error || 'error'}). Showing prices from ${ago(s.lastSuccess)}.`;
      box.append(a);
    }
  }

  function fillBrands() {
    const sel = $('#brand');
    const keep = sel.value || new URLSearchParams(location.hash.slice(1)).get('brand') || '';
    const counts = {};
    for (const p of state.data.products) if (p.brand) counts[p.brand] = (counts[p.brand] || 0) + 1;
    sel.innerHTML = '<option value="">All brands</option>' +
      Object.keys(counts).sort().map((b) => `<option value="${b}">${b[0] + b.slice(1).toLowerCase()} (${counts[b]})</option>`).join('');
    sel.value = counts[keep] ? keep : '';
  }

  function filtered() {
    const q = $('#q').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const brand = $('#brand').value;
    const [smin, smax] = ($('#size').value || '0-999').split('-').map(Number);
    const multi = $('#multi').checked;
    const stockOnly = $('#stock').checked;
    let list = state.data.products.filter((p) => {
      if (brand && p.brand !== brand) return false;
      if ($('#size').value && !(p.size >= smin && p.size <= smax)) return false;
      if (multi && p.storeCount < 2) return false;
      if (stockOnly && !p.offers.some((o) => o.inStock && !o.stale)) return false;
      if (q.length) {
        const hay = (p.title + ' ' + p.key + ' ' + p.offers.map((o) => o.name).join(' ')).toLowerCase();
        if (!q.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
    const disc = (p) => {
      const o = p.offers.find((x) => x.store === p.bestStore);
      return o?.oldPrice ? (o.oldPrice - o.price) / o.oldPrice : 0;
    };
    const sorters = {
      spread: (a, b) => b.spread - a.spread || a.bestPrice - b.bestPrice,
      'price-asc': (a, b) => a.bestPrice - b.bestPrice,
      'price-desc': (a, b) => b.bestPrice - a.bestPrice,
      discount: (a, b) => disc(b) - disc(a),
      size: (a, b) => (a.size || 0) - (b.size || 0) || a.bestPrice - b.bestPrice,
    };
    return list.sort(sorters[$('#sort').value] || sorters.spread);
  }

  function render() {
    writeHash();
    const list = filtered();
    const total = state.data.products.length;
    const multi = state.data.products.filter((p) => p.storeCount > 1).length;
    $('#count').textContent = `${list.length} shown · ${total} products, ${multi} sold in more than one store`;
    $('#empty').hidden = list.length > 0;
    const root = $('#list');
    root.innerHTML = '';
    const tpl = $('#card-tpl');
    const frag = document.createDocumentFragment();
    for (const p of list.slice(0, 300)) frag.append(card(p, tpl));
    root.append(frag);
  }

  function card(p, tpl) {
    const node = tpl.content.firstElementChild.cloneNode(true);
    const storeName = (id) => state.index.stores?.[id]?.name || id;
    node.querySelector('.title').textContent = p.title;
    node.querySelector('.meta').textContent = [p.brand && p.brand[0] + p.brand.slice(1).toLowerCase(), p.size && `${p.size}″`, p.model, `${p.storeCount} store${p.storeCount > 1 ? 's' : ''}`].filter(Boolean).join(' · ');
    const img = node.querySelector('.thumb img');
    if (p.image) { img.src = p.image; img.onerror = () => { img.remove(); node.querySelector('.thumb').classList.add('noimg'); }; }
    else { img.remove(); node.querySelector('.thumb').classList.add('noimg'); }

    const badges = node.querySelector('.badges');
    if (p.previousBest && p.previousBest > p.bestPrice) addBadge(badges, `↓ ${fmt(p.previousBest - p.bestPrice)} since last check`, 'drop');
    if (p.previousBest && p.previousBest < p.bestPrice) addBadge(badges, `↑ ${fmt(p.bestPrice - p.previousBest)} since last check`, 'up');
    const bestOffer = p.offers.find((o) => o.store === p.bestStore && o.price === p.bestPrice);
    if (bestOffer?.oldPrice) addBadge(badges, `−${Math.round((1 - bestOffer.price / bestOffer.oldPrice) * 100)}% at ${storeName(p.bestStore)}`);

    node.querySelector('.best-price').textContent = fmt(p.bestPrice);
    node.querySelector('.best-store').textContent = 'at ' + storeName(p.bestStore);
    if (p.spread > 0) node.querySelector('.best-save').textContent = `${fmt(p.spread)} less than the most expensive`;

    const ol = node.querySelector('.offers');
    for (const o of p.offers) {
      const li = document.createElement('li');
      li.className = 'offer' + (o.store === p.bestStore && o.price === p.bestPrice ? ' is-best' : '') + (!o.inStock ? ' out' : '');
      li.innerHTML = `
        <span class="store"><span class="swatch" style="--c:${STORE_COLORS[o.store] || '#888'}"></span>${esc(storeName(o.store))}</span>
        <span class="oname" title="${esc(o.name)}">${esc(o.name)}${!o.inStock ? ' <small class="tag">out of stock</small>' : ''}${o.stale ? ` <small class="tag" title="This store could not be checked in the last run">price from ${ago(o.seenAt)}</small>` : ''}</span>
        <span class="oprice">${o.oldPrice ? `<s>${fmt(o.oldPrice)}</s>` : ''}<strong>${fmt(o.price)}</strong></span>
        <a class="go" href="${esc(/^https?:\/\//i.test(o.url) ? o.url : "#")}" target="_blank" rel="noopener">View ↗</a>`;
      ol.append(li);
    }
    return node;
  }

  function addBadge(el, text, cls = '') {
    const b = document.createElement('span');
    b.className = 'badge ' + cls;
    b.textContent = text;
    el.append(b);
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let t;
  $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(render, 120); });
  for (const id of ['brand', 'size', 'sort', 'multi', 'stock']) $('#' + id).addEventListener('change', (e) => { e.target.dataset.touched = '1'; render(); });
  load();
})();
