import JsBarcode from 'jsbarcode';

// Code-128 encoding via JsBarcode's encoder (no canvas): returns the module string, e.g. "11010010000…",
// so the PDF can draw real vector bars instead of an image. Printable ASCII only (32–126).
export function encodeCode128(value) {
  if (typeof value !== 'string' || value === '') return { error: 'empty' };
  if (!/^[\x20-\x7e]+$/.test(value)) return { error: 'characters' };
  try {
    const target = {};
    JsBarcode(target, value, { format: 'CODE128', valid: () => {} });
    const enc = target.encodings?.[0]?.data;
    if (typeof enc !== 'string' || !enc) return { error: 'encode' };
    return { bits: enc, modules: enc.length };
  } catch {
    return { error: 'encode' };
  }
}

// Merge consecutive '1' modules into runs: [{ start, len }] in module units.
export function barRuns(bits) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= bits.length; i++) {
    const on = bits[i] === '1';
    if (on && start < 0) start = i;
    if (!on && start >= 0) { runs.push({ start, len: i - start }); start = -1; }
  }
  return runs;
}
