// Albanian stores write prices many ways: "39,990 L", "48.990L", "43 990 Lekë",
// "109.900 Lekë", "30,990Lek", "79990", "39990.00". All are whole Lek amounts.

export function parsePrice(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? Math.round(input) : null;
  let s = String(input).replace(/ /g, ' ');
  const m = s.match(/\d[\d.,\s]*/);
  if (!m) return null;
  s = m[0].trim().replace(/\s+/g, '');
  // trailing decimals like 39990.00 or 39.990,00
  if (/[.,]\d{2}$/.test(s) && !/[.,]\d{3}$/.test(s)) s = s.slice(0, -3);
  s = s.replace(/[.,]/g, '');
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "L" may be glued to the next word ("48.990L1.490 lekë/muaj", "35.990LKurse"), so no \b after it,
// but "2025 LED" must not read as a price.
const PRICE_RE = /(?<![A-Za-z0-9.,])(\d{1,3}(?:[.,\s ]\d{3})+|\d{4,7})(?:[.,]\d{2})?\s*(?:LEK[ËE]?|L(?!ED|CD|CE)|ALL\b)/gi;

// Every Lek amount found in a block of text.
export function findPrices(text) {
  const out = [];
  for (const m of String(text || '').matchAll(PRICE_RE)) {
    const p = parsePrice(m[1]);
    if (p && p >= 100) out.push(p);
  }
  return out;
}
