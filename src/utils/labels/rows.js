// Row validation for a label run. Nothing is printed until every row is clean: a problem is a
// blocking issue the user fixes (in Shopify, or by editing/removing the row). The one exception is a
// missing price when the run allows it — those rows are skipped and listed instead.

import { layoutLabel, rowSize } from './layout.js';
import { sanitizeText, formatPrice, titleFor } from './text.js';

export const MAX_LABELS_PER_RUN = 1000;
const PAGE_SLACK_MM = 0.5; // the Dymo sample pages are a hair under the nominal label size (153 pt = 53.98 mm vs 54)

const PRICE_FIELD = { price: 'price', compareAt: 'compareAtPrice', vendorRrp: 'vendorRrp' };
export const PRICE_SOURCE_LABELS = { price: 'Shopify price', compareAt: 'Compare-at price', vendorRrp: 'Vendor RRP' };

// Strict: digits only, at least 1. "2.5", "-1", "0", "", "abc", "1e3" are all errors.
export function parseQty(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n : null;
}

// What the layout engine needs for one variant under this template (sanitised strings, null when off/absent).
export function layoutDataFor(v, cfg) {
  return {
    title: cfg.title.on ? sanitizeText(titleFor(v, cfg.title.mode)).text : null,
    price: cfg.price.on ? formatPrice(v[PRICE_FIELD[cfg.price.source]], cfg.price) : null,
    sku: cfg.sku.on ? sanitizeText(v.sku).text : null,
    custom: cfg.custom.on ? sanitizeText(cfg.custom.text).text : null,
    barcode: (v.barcode ?? '').trim(),
  };
}

const block = (code, message) => ({ code, message, severity: 'block' });

// Row: { id, sku, qty (string|number), variant: null | {...}, resolution: null | 'blank-sku'|'not-found'|'archived'|'multiple'|'pending'|'lookup-failed' }
export function checkRows(rows, cfg, measure, { allowNoPrice = false } = {}) {
  const runErrors = [];
  for (const [what, text] of [['Price prefix', cfg.price.prefix], ['Custom text', cfg.custom.text]]) {
    const { bad } = sanitizeText(text);
    if (bad.length) runErrors.push(`${what} contains characters that can't be printed: ${bad.join(' ')}`);
  }
  const row = rowSize(cfg);
  if (cfg.pageMode === 'custom' && (cfg.page.w < row.w - PAGE_SLACK_MM || cfg.page.h < row.h - PAGE_SLACK_MM)) {
    runErrors.push('The label (or the row of labels) is larger than the page size — set Page size to "Same as label" (or enlarge the page)');
  }

  // Duplicates by variant (or by SKU text for rows that never resolved).
  const keyOf = (r) => r.variant?.variantId ?? `sku:${(r.sku || '').trim().toLowerCase()}`;
  const counts = new Map();
  for (const r of rows) counts.set(keyOf(r), (counts.get(keyOf(r)) || 0) + 1);

  const results = new Map();
  let totalLabels = 0;

  for (const row of rows) {
    const issues = [];
    const v = row.variant;
    const qty = parseQty(row.qty);
    if (qty == null) issues.push(block('BAD_QTY', `Quantity "${row.qty ?? ''}" must be a whole number of at least 1`));
    if (counts.get(keyOf(row)) > 1 && (v || (row.sku || '').trim())) issues.push(block('DUPLICATE', 'This variant appears more than once — keep one row'));

    let layout = null;
    if (!v) {
      const msg = {
        'blank-sku': 'SKU is blank',
        'not-found': `SKU "${row.sku}" was not found in Shopify`,
        archived: `SKU "${row.sku}" belongs to an archived product`,
        multiple: `SKU "${row.sku}" matches more than one product — pick one`,
        pending: `Looking up "${row.sku}" in Shopify…`,
        'lookup-failed': `Looking up "${row.sku}" failed — press Re-check`,
      }[row.resolution] || `SKU "${row.sku}" is not resolved`;
      issues.push(block((row.resolution || 'not-found').toUpperCase().replace(/-/g, '_'), msg));
    } else {
      if (v.productStatus === 'ARCHIVED') issues.push(block('ARCHIVED', 'Product is archived'));

      const barcode = (v.barcode ?? '').trim();
      if (!barcode) issues.push(block('NO_BARCODE', 'No barcode set in Shopify'));

      const title = sanitizeText(titleFor(v, cfg.title.mode));
      const sku = sanitizeText(v.sku);
      const badChars = [...(cfg.title.on ? title.bad : []), ...(cfg.sku.on ? sku.bad : [])];
      if (badChars.length) issues.push(block('BAD_TEXT', `Contains characters that can't be printed: ${[...new Set(badChars)].join(' ')}`));

      let price = null;
      if (cfg.price.on) {
        price = formatPrice(v[PRICE_FIELD[cfg.price.source]], cfg.price);
        if (price == null) {
          issues.push({
            code: 'NO_PRICE',
            message: `No ${PRICE_SOURCE_LABELS[cfg.price.source]} for this variant`,
            severity: allowNoPrice ? 'skip' : 'block',
          });
        }
      }

      if (!issues.some((i) => i.severity === 'block' && ['NO_BARCODE', 'BAD_TEXT'].includes(i.code)) && barcode) {
        layout = layoutLabel(cfg, {
          title: cfg.title.on ? title.text : null,
          price,
          sku: cfg.sku.on ? sku.text : null,
          custom: cfg.custom.on ? sanitizeText(cfg.custom.text).text : null,
          barcode,
        }, measure);
        if (!layout.ok) {
          for (const e of layout.errors) issues.push(block(e.code === 'BARCODE_INVALID' ? 'BAD_BARCODE' : e.code, e.message));
        }
      }
    }

    if (qty != null) totalLabels += qty;
    results.set(row.id, { issues, layout, qty });
  }

  if (totalLabels > MAX_LABELS_PER_RUN) {
    runErrors.push(`${totalLabels} labels is over the ${MAX_LABELS_PER_RUN}-label limit per run — split it into smaller runs`);
  }

  const blockedRows = rows.filter((r) => results.get(r.id).issues.some((i) => i.severity === 'block'));
  const skippedRows = rows.filter((r) => {
    const { issues } = results.get(r.id);
    return !issues.some((i) => i.severity === 'block') && issues.some((i) => i.severity === 'skip');
  });
  const printable = rows
    .filter((r) => results.get(r.id).issues.length === 0 && results.get(r.id).layout?.ok)
    .map((r) => ({ row: r, layout: results.get(r.id).layout, qty: results.get(r.id).qty }));

  return {
    results, runErrors, totalLabels, blockedRows, skippedRows, printable,
    ready: runErrors.length === 0 && blockedRows.length === 0 && printable.length > 0,
  };
}
