// Built-in label types. Read-only code constants (a wrong size can be fixed by a deploy); a user's own
// printers/sizes are saved as templates in the DB (LabelTemplate).
//
// `label` is the printable label (what the vendor spec says, in page orientation). `page` is the paper
// size the driver expects: for the Dymo presets that is the size of the PDFs the Shopify app produces
// (79 × 252 pt and 71 × 153 pt), a little larger than the label, with the label centred inside it.
// The Dymo 30252 page size is inferred from that sample — print one to confirm (TEST_CASES_LABELS.txt).

const PT = 25.4 / 72;
const pt = (n) => Math.round(n * PT * 100) / 100;

export const BUILT_IN_PRESETS = [
  { key: 'dymo-30252', name: 'Dymo 30252 Large (26 × 79 mm)', label: { w: 26, h: 79 }, page: { w: pt(79), h: pt(252) }, rotation: 90 },
  { key: 'dymo-30336', name: 'Dymo 30336 Small (25 × 54 mm)', label: { w: 25, h: 54 }, page: { w: pt(71), h: pt(153) }, rotation: 90 },
  { key: 'dymo-30332', name: 'Dymo 30332 Square (25 × 25 mm)', label: { w: 25, h: 25 }, rotation: 0 },
  { key: 'dymo-30299', name: 'Dymo 30299 Price Tag (10 × 19 mm)', label: { w: 10, h: 19 }, rotation: 90, minimal: true },
  { key: 'zebra-10010039', name: 'Zebra 10010039 (51 × 25 mm)', label: { w: 51, h: 25 }, rotation: 0 },
  { key: 'zebra-10010044', name: 'Zebra 10010044 (76 × 51 mm)', label: { w: 76, h: 51 }, rotation: 0 },
  { key: 'avery-2160-roll', name: 'Avery 2160 roll (67 × 25 mm)', label: { w: 67, h: 25 }, rotation: 0 },
];

export const CUSTOM_PRESET_KEY = 'custom';
export const DEFAULT_DPI = 203;

const round1 = (n) => Math.round(n * 10) / 10;

// Largest bar width (1–3 printer dots) whose ~13-digit Code-128 (≈113 modules incl. quiet zone) fits the frame width.
function pickModuleMm(frameW, dpi) {
  const dot = 25.4 / dpi;
  for (const dots of [3, 2, 1]) if (dots * dot * 113 <= frameW * 0.95) return round1k(dots * dot);
  return round1k(dot);
}
const round1k = (n) => Math.round(n * 1000) / 1000;

// Default settings for a label size. Everything is authored at this size (`design`); resizing the label
// later scales it all proportionally (see layout.js).
export function buildConfig({ label, page, rotation = 0, presetKey = CUSTOM_PRESET_KEY, minimal = false }) {
  const rotated = rotation === 90 || rotation === 270;
  const frame = rotated ? { w: label.h, h: label.w } : { w: label.w, h: label.h };
  const k = frame.h / 25; // the Dymo samples are ~25 mm tall in reading orientation
  const dpi = DEFAULT_DPI;
  return {
    v: 1,
    presetKey,
    page: page ? { ...page } : { ...label },
    pageMode: page ? 'custom' : 'label',
    label: { ...label },
    design: { ...label },
    lockRatio: true,
    rotation,
    offset: { x: 0, y: 0 },
    printerDpi: dpi,
    padding: round1(Math.max(0.5, k)),
    gap: round1(Math.max(0.2, 0.5 * k)),
    title: { on: !minimal, mode: 'combined', size: round1(Math.max(4, 11 * k)), minSize: round1(Math.max(3, 6 * k)), maxLines: 2, bold: true },
    price: { on: true, source: 'price', prefix: 'RM', decimals: 2, size: round1(Math.max(4, 10 * k)) },
    sku: { on: false, size: round1(Math.max(3, 8 * k)) },
    custom: { on: false, text: '', size: round1(Math.max(3, 8 * k)) },
    number: { on: true, size: round1(Math.max(3, 8 * k)) },
    barcode: { scale: 1, moduleMm: pickModuleMm(frame.w, dpi), heightMm: round1(Math.max(3, 7 * k)), quietModules: 6 },
  };
}

export function configFromPreset(key) {
  const p = BUILT_IN_PRESETS.find((x) => x.key === key);
  if (!p) return null;
  return buildConfig({ label: p.label, page: p.page, rotation: p.rotation, presetKey: p.key, minimal: p.minimal });
}
