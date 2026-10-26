// Pure edits to a label template config, so the rules (proportional resize, preset switch) are testable.
import { configFromPreset } from './presets.js';

const round2 = (n) => Math.round(n * 100) / 100;

// Whole-label size. With the ratio locked the other side follows, so the layout never distorts;
// unlocked, the sides are independent (the content then scales by the smaller ratio, centred).
export function setLabelDim(cfg, dim, value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0 || v > 500) return cfg;
  const label = { ...cfg.label, [dim]: round2(v) };
  if (cfg.lockRatio) {
    const other = dim === 'w' ? 'h' : 'w';
    label[other] = round2((v * cfg.design[other]) / cfg.design[dim]);
  }
  return { ...cfg, label };
}

// Switch label type: sizes, page, rotation and spacing come from the preset; the user's choices about
// *what* is printed (fields, price source, prefix, custom text, printer dpi) are carried over.
export function applyPreset(cfg, key) {
  const next = configFromPreset(key);
  if (!next) return cfg;
  return {
    ...next,
    printerDpi: cfg.printerDpi,
    title: { ...next.title, on: cfg.title.on, mode: cfg.title.mode, bold: cfg.title.bold },
    price: { ...next.price, on: cfg.price.on, source: cfg.price.source, prefix: cfg.price.prefix, decimals: cfg.price.decimals },
    sku: { ...next.sku, on: cfg.sku.on },
    custom: { ...next.custom, on: cfg.custom.on, text: cfg.custom.text },
    number: { ...next.number, on: cfg.number.on },
  };
}
