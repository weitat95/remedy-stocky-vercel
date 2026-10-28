// Pure label layout: no DOM, no jsPDF. Everything is computed in the "reading frame" — the label as the
// reader sees it, origin top-left, in mm — and render.js maps it onto the page for the chosen rotation.
//
// Scaling: sizes in a config are authored for `design` (a label size). The actual label may differ; the
// whole layout scales by min(label.w/design.w, label.h/design.h), so a locked-ratio resize is exactly
// proportional. `barcode.scale` is a separate multiplier for the barcode alone — text keeps its size and
// the barcode must fit in the room that is left (it never silently shrinks or gets cut off).

import { encodeCode128, barRuns } from './barcode.js';

export const PT_MM = 25.4 / 72;
const LINE_HEIGHT = 1.2;
const SHRINK_STEP_PT = 0.25;
const SHRINK_TO_FIT_FLOOR_PT = 3; // absolute smallest title size when title.shrinkToFit is on
const MIN_LINE_SHRINK = 0.6; // single-line fields may shrink to 60% of their size before the row is blocked

export const frameOf = (label, rotation) =>
  rotation === 90 || rotation === 270 ? { w: label.h, h: label.w } : { w: label.w, h: label.h };

export const scaleOf = (cfg) => Math.min(cfg.label.w / cfg.design.w, cfg.label.h / cfg.design.h);

export const dotMm = (dpi) => 25.4 / dpi;
export const snapToDots = (mm, dpi) => Math.max(1, Math.round(mm / dotMm(dpi))) * dotMm(dpi);

const err = (code, message, extra = {}) => ({ code, message, ...extra });

// Greedy word wrap; returns null when a single word is wider than the line.
function wrap(text, size, bold, maxW, measure) {
  const lines = [];
  let cur = '';
  for (const word of text.split(' ')) {
    const next = cur ? `${cur} ${word}` : word;
    if (measure(next, size, bold) <= maxW) { cur = next; continue; }
    if (!cur || measure(word, size, bold) > maxW) return null;
    lines.push(cur);
    cur = word;
  }
  if (cur) lines.push(cur);
  return lines;
}

// A one-line field: shrink in small steps down to 60%, else it cannot fit.
function fitLine(text, size, bold, maxW, measure) {
  for (let s = size; s >= size * MIN_LINE_SHRINK - 1e-9; s -= SHRINK_STEP_PT) {
    if (measure(text, s, bold) <= maxW) return s;
  }
  return null;
}

const lineBox = (sizePt) => sizePt * PT_MM * LINE_HEIGHT;

// data: { title, price, sku, custom, barcode } — already sanitised strings (or null when absent/off).
// measure(text, sizePt, bold) → width in mm.
export function layoutLabel(cfg, data, measure) {
  const errors = [];
  const s = scaleOf(cfg);
  const frame = frameOf(cfg.label, cfg.rotation);
  const pad = cfg.padding * s;
  const gap = cfg.gap * s;
  const innerW = frame.w - 2 * pad;
  const innerH = frame.h - 2 * pad;
  if (innerW <= 0 || innerH <= 0) {
    return { ok: false, errors: [err('NO_FIT_HEIGHT', 'Padding leaves no room on this label')], frame, scale: s, elements: [] };
  }

  // ── Barcode (the one thing that's mandatory) ──
  const enc = encodeCode128(data.barcode);
  if (enc.error) {
    return { ok: false, errors: [err('BARCODE_INVALID', 'Barcode cannot be encoded as Code-128')], frame, scale: s, elements: [] };
  }
  const bScale = cfg.barcode.scale;
  const module = snapToDots(cfg.barcode.moduleMm * s * bScale, cfg.printerDpi);
  const barW = enc.modules * module;
  const barH = cfg.barcode.heightMm * s * bScale;
  const quiet = cfg.barcode.quietModules * module;
  if (barW + 2 * quiet > frame.w + 1e-9) {
    errors.push(err('BARCODE_TOO_WIDE',
      `Barcode needs ${(barW + 2 * quiet).toFixed(1)} mm (incl. quiet zones) but the label is ${frame.w.toFixed(1)} mm wide — lower the barcode size`,
      { needed: barW + 2 * quiet, available: frame.w }));
  }

  // ── Fixed-size text blocks (price, sku, custom, number) ──
  const fixedAbove = []; // between title and bars
  const addLine = (key, text, size, bold = false) => {
    if (!text) return null;
    const fitted = fitLine(text, size * s, bold, innerW, measure);
    if (fitted == null) {
      errors.push(err('LINE_TOO_WIDE', `${key} text "${text}" does not fit the label width`, { field: key }));
      return null;
    }
    return { key, lines: [text], size: fitted, bold, h: lineBox(fitted) };
  };
  if (cfg.price.on) fixedAbove.push(addLine('price', data.price, cfg.price.size));
  if (cfg.sku.on) fixedAbove.push(addLine('sku', data.sku, cfg.sku.size));
  if (cfg.custom.on) fixedAbove.push(addLine('custom', data.custom, cfg.custom.size));
  const numberBlock = cfg.number.on ? addLine('number', data.barcode, cfg.number.size) : null;
  const above = fixedAbove.filter(Boolean);

  // Height of everything except the title.
  const rest = [...above, { key: 'bars', h: barH }, ...(numberBlock ? [numberBlock] : [])];
  const restH = rest.reduce((t, b) => t + b.h, 0) + gap * (rest.length - 1);

  // ── Title: the largest size (down to minSize, or lower with shrinkToFit) that wraps within maxLines AND fits the height ──
  let titleBlock = null;
  if (cfg.title.on && data.title) {
    const maxH = innerH - restH - gap;
    const bold = cfg.title.bold;
    // shrinkToFit: a title too long for its label keeps shrinking below minSize (this label only; others unaffected)
    const floor = cfg.title.shrinkToFit ? Math.min(SHRINK_TO_FIT_FLOOR_PT, cfg.title.minSize * s) : cfg.title.minSize * s;
    for (let sz = cfg.title.size * s; sz >= floor - 1e-9; sz -= SHRINK_STEP_PT) {
      const lines = wrap(data.title, sz, bold, innerW, measure);
      if (!lines || lines.length > cfg.title.maxLines) continue;
      const h = lines.length * lineBox(sz);
      if (h <= maxH + 1e-9) { titleBlock = { key: 'title', lines, size: sz, bold, h }; break; }
    }
    if (!titleBlock) {
      errors.push(err('TITLE_NO_FIT',
        `Title "${data.title}" does not fit (max ${cfg.title.maxLines} line${cfg.title.maxLines === 1 ? '' : 's'}, smallest ${cfg.title.shrinkToFit ? Math.min(SHRINK_TO_FIT_FLOOR_PT, cfg.title.minSize * s).toFixed(1) : cfg.title.minSize}pt)`));
    }
  }

  const blocks = [...(titleBlock ? [titleBlock] : []), ...rest];
  const totalH = blocks.reduce((t, b) => t + b.h, 0) + gap * (blocks.length - 1);
  if (!errors.length && totalH > innerH + 1e-9) {
    errors.push(err('NO_FIT_HEIGHT',
      `Content needs ${totalH.toFixed(1)} mm of height but only ${innerH.toFixed(1)} mm is available — lower the barcode size or turn off a field`,
      { needed: totalH, available: innerH }));
  }
  if (errors.length) return { ok: false, errors, frame, scale: s, elements: [] };

  // ── Place: centred block, every line centred horizontally ──
  const elements = [];
  let y = pad + (innerH - totalH) / 2;
  for (const b of blocks) {
    if (b.key === 'bars') {
      const x0 = (frame.w - barW) / 2;
      for (const r of barRuns(enc.bits)) elements.push({ kind: 'rect', x: x0 + r.start * module, y, w: r.len * module, h: barH });
    } else {
      const lh = lineBox(b.size);
      b.lines.forEach((text, i) => {
        const w = measure(text, b.size, b.bold);
        elements.push({ kind: 'text', text, x: (frame.w - w) / 2, y: y + i * lh + lh / 2 + 0.36 * b.size * PT_MM, size: b.size, bold: b.bold });
      });
    }
    y += b.h + gap;
  }
  return { ok: true, errors: [], frame, scale: s, elements, stats: { modules: enc.modules, module, barW, barH, totalH, innerH } };
}

// Largest barcode.scale (0.2–3) at which every sample still lays out — the "Fit barcode" button.
// Returns null when even the smallest size fails for a reason other than the barcode.
export function maxBarcodeScale(cfg, samples, measure) {
  const okAt = (scale) => samples.every((d) => {
    const r = layoutLabel({ ...cfg, barcode: { ...cfg.barcode, scale } }, d, measure);
    return r.ok;
  });
  if (!okAt(0.2)) return null;
  let lo = 0.2;
  let hi = 3;
  if (okAt(hi)) return hi;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (okAt(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 100) / 100;
}

// Where the label sits on the page and how reading-frame points map onto it, for the 4 rotations.
export function pageGeometry(cfg) {
  const page = cfg.pageMode === 'label' ? { ...cfg.label } : { ...cfg.page };
  const lx = (page.w - cfg.label.w) / 2 + cfg.offset.x;
  const ly = (page.h - cfg.label.h) / 2 + cfg.offset.y;
  const { w: lw, h: lh } = cfg.label;
  const map = {
    0: (x, y) => [lx + x, ly + y],
    90: (x, y) => [lx + y, ly + lh - x],
    180: (x, y) => [lx + lw - x, ly + lh - y],
    270: (x, y) => [lx + lw - y, ly + x],
  }[cfg.rotation];
  return { page, label: { x: lx, y: ly, w: lw, h: lh }, map, fits: page.w >= lw - 0.5 && page.h >= lh - 0.5 };
}
