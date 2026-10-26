// Label text rules. jsPDF's built-in Helvetica only covers Latin-1, so anything outside it can't be
// printed correctly; those rows are blocked (never silently dropped or replaced with "?").

// Typographic characters that are common in Shopify titles and have a faithful ASCII equivalent.
const NORMALISE = {
  '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...', '\u00a0': ' ', '•': '*',
};

// Returns the cleaned text and the characters that cannot be printed.
export function sanitizeText(input) {
  const s = String(input ?? '').replace(/[–—‘’“”…\u00a0•]/g, (c) => NORMALISE[c]);
  const bad = new Set();
  let out = '';
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if ((cp >= 32 && cp <= 126) || (cp >= 160 && cp <= 255)) out += ch;
    else if (/\s/.test(ch)) out += ' ';
    else bad.add(ch);
  }
  return { text: out.replace(/\s+/g, ' ').trim(), bad: [...bad] };
}

// Shopify prices arrive as decimal strings ("99.00"). Returns null when the value is absent.
export function formatPrice(value, { prefix = '', decimals = 2 } = {}) {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return `${prefix}${n.toFixed(decimals)}`;
}

export function titleFor(variant, mode) {
  const product = (variant.productTitle || '').trim();
  const v = (variant.variantTitle || '').trim();
  const hasVariant = v && v !== 'Default Title';
  if (mode === 'product') return product;
  if (mode === 'variant') return hasVariant ? v : product;
  return hasVariant ? `${product} - ${v}` : product;
}
