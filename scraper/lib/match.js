// Turns a store's product name into a grouping key so that the same TV
// sold by different stores lands in the same row.
//
//   "TV SAMSUNG LED UE55U8072FUXXH"                    -> samsung|55|u8072f
//   "Samsung 55\" Crystal UHD U8072F 4K Smart TV (2025)" -> samsung|55|u8072f
//   "TELEVIZOR LG 55UR73006LA" / "TV 55UR73006LA.AEU"  -> lg|55ur73006la
//   "TV LED PHILIPS 65PUS7000/12"                      -> philips|65pus7000

export const BRANDS = [
  'SAMSUNG', 'LG', 'PHILIPS', 'SONY', 'HISENSE', 'TCL', 'XIAOMI', 'GRUNDIG', 'FUEGO',
  'TELEFUNKEN', 'THOMSON', 'PANASONIC', 'SHARP', 'HITACHI', 'ELEKTRA', 'LIVIN', 'DELUX',
  'FOBEM', 'SUNNY', 'AXEN', 'LOBOD', 'VOX', 'BEKO', 'TOSHIBA', 'JVC', 'CHIQ', 'NOKIA',
  'METZ', 'SENCOR', 'TESLA', 'STRONG', 'BLAUPUNKT', 'VIVAX', 'NEO', 'FINLUX', 'GOGEN',
];

// Model-number prefixes that identify a brand when the brand word is missing.
const MODEL_BRAND_HINTS = [
  [/^(QE|UE|GQ|GU)\d{2}/, 'SAMSUNG'],
  [/^OLED\d{2}|^\d{2}(UR|UQ|UT|UA|QNED|NANO|UP|UM|LQ)\d/, 'LG'],
  [/^\d{2}(PUS|PFS|PHS|OLED|PML)\d/, 'PHILIPS'],
  [/^(KD|XR|K)-?\d{2}/, 'SONY'],
  [/^\d{2}(GGU|GHU|GFU|GEU)\d/, 'GRUNDIG'],
  [/^\d{2}(EL|ELU|VE)\d/, 'FUEGO'],
  [/^\d{2}(P|C|V|T|Q)\d{2,3}K?$/, 'TCL'],
  [/^\d{2}(A|E|U)\d[A-Z]{0,3}$/, 'HISENSE'],
];

const NOISE = new Set([
  'TV', 'TELEVIZOR', 'TELEVIZORE', 'LED', 'QLED', 'OLED', 'QNED', 'NEO', 'MINI', 'MINILED',
  'UHD', 'FHD', 'HD', '4K', '8K', 'SMART', 'ANDROID', 'GOOGLE', 'WEBOS', 'TIZEN', 'CRYSTAL',
  'ULTRA', 'VISION', 'AI', 'OS', 'THE', 'ME', 'DHE', 'INCH', 'INÇ', 'DLED', 'DVB', 'T2', 'C', 'S2',
]);

export function normalizeName(name) {
  return String(name || '')
    .replace(/&#8243;|&#8221;|″|”|“|''|’’/g, '"')
    .replace(/&#8217;|’|‘/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectBrand(upperName, model) {
  for (const b of BRANDS) {
    if (new RegExp(`(^|[^A-Z])${b}([^A-Z]|$)`).test(upperName)) return b;
  }
  if (model) for (const [re, b] of MODEL_BRAND_HINTS) if (re.test(model)) return b;
  return null;
}

// Tokens that look like model numbers: letters and digits mixed, 5+ chars.
function modelTokens(upper) {
  return upper
    .split(/[\s,()|]+/)
    .map((t) => t.replace(/^["'*-]+|["'*:;-]+$/g, ''))
    .filter((t) => t.length >= 5 && /\d/.test(t) && /[A-Z]/.test(t))
    .filter((t) => !/^\d{4}$/.test(t) && !/^(DVB|HDMI|USB)/.test(t) && !/^\d+(HZ|W|GB|MB|CM|MM)$/.test(t));
}

// Samsung: QE55QN80FAUXXH -> { size: 55, series: 'QN80F' }
function parseSamsungModel(code) {
  const m = code.match(/^(QE|UE|GQ|GU|TQ)(\d{2,3})([A-Z]{1,3}\d{1,4})([A-Z])?(.*)$/);
  if (!m) return null;
  let series = m[3];
  // keep the trailing letter (model year, e.g. F in U8072F) unless it starts the region code (UXXH)
  if (m[4] && !/^X[XZ]/.test(m[5] || '')) series += m[4];
  return { size: parseInt(m[2], 10), series };
}

export function detectSize(upper, model) {
  const m =
    upper.match(/(\d{2,3})\s*("|''|'|INCH|INÇ|INC\b|”)/) ||
    upper.match(/\b(\d{2,3})\s*(?:-|\s)?(?:UHD|FHD|HD|4K|QLED|OLED|LED)\b/);
  if (m) return parseInt(m[1], 10);
  if (model) {
    const mm = model.match(/^(?:[A-Z]{2,4}-?)?(\d{2,3})[A-Z]/);
    if (mm) return parseInt(mm[1], 10);
  }
  const t = upper.match(/\b(\d{2,3})\b(?!\s*(HZ|W|GB|CM|MM|%))/);
  if (t) {
    const n = parseInt(t[1], 10);
    if (n >= 19 && n <= 120) return n;
  }
  return null;
}

export function productKey(rawName) {
  const name = normalizeName(rawName);
  const upper = name.toUpperCase();
  const tokens = modelTokens(upper);

  // 1) Samsung full model code anywhere in the name
  for (const t of tokens) {
    const s = parseSamsungModel(t);
    if (s) return { key: `samsung|${s.size}|${s.series.toLowerCase()}`, brand: 'SAMSUNG', size: s.size, model: t };
  }

  const firstModel = tokens.find((t) => !/^(UHD|FHD)/.test(t)) || null;
  const brand = detectBrand(upper, firstModel);
  const size = detectSize(upper, firstModel);

  // 2) Samsung name without a full code: "Samsung 55" Crystal UHD U8072F 4K"
  if (brand === 'SAMSUNG' && size) {
    const series = upper
      .split(/[\s,()]+/)
      .find((t) => /^[A-Z]{1,3}\d{1,4}[A-Z]?$/.test(t) && !/^(\d+K|Q4|AI|T2|S2)$/.test(t) && t.length >= 3);
    if (series) return { key: `samsung|${size}|${series.toLowerCase()}`, brand, size, model: series };
  }

  // 3) Any other brand with a model code
  if (firstModel) {
    const core = firstModel.split(/[/.]/)[0].replace(/-/g, '');
    if (core.length >= 5) {
      return { key: `${(brand || 'x').toLowerCase()}|${core.toLowerCase()}`, brand, size: size || detectSize('', core), model: core };
    }
  }

  // 4) No model code: brand + size + remaining descriptive words
  const words = upper
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !NOISE.has(w) && w !== brand && !/^\d{2,3}$/.test(w) && !/^20\d\d$/.test(w));
  return {
    key: `${(brand || 'x').toLowerCase()}|${size || 'x'}|${words.join('-').toLowerCase() || 'tv'}`,
    brand,
    size,
    model: null,
  };
}
