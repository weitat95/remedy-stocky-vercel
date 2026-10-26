import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCode128 } from './barcode.js';
import { configFromPreset, buildConfig } from './presets.js';
import { layoutLabel, maxBarcodeScale, frameOf, scaleOf, pageGeometry, PT_MM } from './layout.js';
import { checkRows, parseQty, MAX_LABELS_PER_RUN } from './rows.js';
import { sanitizeText, formatPrice, titleFor } from './text.js';
import { makeMeasure, renderLabelsPdf } from './render.js';

// Helvetica-ish: 0.5 em per character.
const fake = (text, size) => text.length * size * PT_MM * 0.5;
const real = makeMeasure();

const variant = (o = {}) => ({
  variantId: 'gid://shopify/ProductVariant/1', productId: 'gid://shopify/Product/1', sku: 'WAL-BLK',
  productTitle: 'Card Wallet', variantTitle: 'Black', productStatus: 'ACTIVE',
  barcode: '30000444', price: '99.00', compareAtPrice: null, vendorRrp: null, ...o,
});
const row = (o = {}) => ({ id: 'r1', sku: 'WAL-BLK', qty: '2', variant: variant(), resolution: null, ...o });

test('code128: encodes printable ASCII, rejects the rest', () => {
  assert.ok(encodeCode128('30000444').modules > 50);
  assert.equal(encodeCode128('').error, 'empty');
  assert.equal(encodeCode128('abc é').error, 'characters');
  assert.equal(encodeCode128('a\tb').error, 'characters');
});

test('text: typographic dashes/quotes normalised, non-Latin reported', () => {
  assert.deepEqual(sanitizeText('Card – Wallet’s “Black”'), { text: 'Card - Wallet\'s "Black"', bad: [] });
  assert.deepEqual(sanitizeText('Café').bad, []);
  assert.deepEqual(sanitizeText('钱包 Black').bad, ['钱', '包']);
  assert.equal(sanitizeText('  a   b ').text, 'a b');
});

test('text: price + title formats', () => {
  assert.equal(formatPrice('99', { prefix: 'RM', decimals: 2 }), 'RM99.00');
  assert.equal(formatPrice('99.5', { prefix: '', decimals: 0 }), '100');
  assert.equal(formatPrice(null), null);
  assert.equal(formatPrice(''), null);
  assert.equal(titleFor({ productTitle: 'Wallet', variantTitle: 'Default Title' }, 'combined'), 'Wallet');
  assert.equal(titleFor({ productTitle: 'Wallet', variantTitle: 'Black' }, 'combined'), 'Wallet - Black');
  assert.equal(titleFor({ productTitle: 'Wallet', variantTitle: 'Black' }, 'variant'), 'Black');
  assert.equal(titleFor({ productTitle: 'Wallet', variantTitle: 'Black' }, 'product'), 'Wallet');
});

test('qty: strict whole numbers only', () => {
  assert.equal(parseQty('3'), 3);
  for (const bad of ['', '0', '-1', '2.5', 'abc', '1e3', ' ', null, undefined]) assert.equal(parseQty(bad), null, String(bad));
});

test('presets: Dymo pages match the sample PDFs; every preset lays out a normal row', () => {
  const large = configFromPreset('dymo-30252');
  assert.equal(Math.round(large.page.w / PT_MM), 79);
  assert.equal(Math.round(large.page.h / PT_MM), 252);
  const small = configFromPreset('dymo-30336');
  assert.equal(Math.round(small.page.w / PT_MM), 71);
  assert.equal(Math.round(small.page.h / PT_MM), 153);
  for (const key of ['dymo-30252', 'dymo-30336', 'dymo-30332', 'zebra-10010039', 'zebra-10010044', 'avery-2160-roll']) {
    const r = layoutLabel(configFromPreset(key), { title: 'Card Wallet - Black', price: 'RM99.00', barcode: '30000444' }, real);
    assert.ok(r.ok, `${key}: ${r.errors.map((e) => e.message)}`);
  }
  const tag = layoutLabel(configFromPreset('dymo-30299'), { price: 'RM99.00', barcode: '30000444' }, real);
  assert.ok(tag.ok, tag.errors.map((e) => e.message).join());
});

test('layout: everything stays inside the frame and stacks title, price, bars, number', () => {
  const cfg = configFromPreset('dymo-30336');
  const r = layoutLabel(cfg, { title: 'Card Wallet - Black', price: 'RM99.00', barcode: '30000444' }, real);
  assert.ok(r.ok);
  const { w, h } = r.frame;
  for (const el of r.elements) {
    assert.ok(el.x >= -1e-6 && el.y >= -1e-6 && el.y <= h + 1e-6, JSON.stringify(el));
    assert.ok((el.kind === 'rect' ? el.x + el.w : el.x) <= w + 1e-6);
    if (el.kind === 'rect') assert.ok(el.y + el.h <= h + 1e-6);
  }
  const texts = r.elements.filter((e) => e.kind === 'text');
  assert.deepEqual(texts.map((t) => t.text), ['Card Wallet - Black', 'RM99.00', '30000444']);
  assert.ok(texts[0].y < texts[1].y && texts[1].y < texts[2].y);
  const barTop = Math.min(...r.elements.filter((e) => e.kind === 'rect').map((e) => e.y));
  assert.ok(texts[1].y < barTop && barTop < texts[2].y);
});

test('layout: whole-label resize with locked ratio scales every size proportionally', () => {
  const base = configFromPreset('dymo-30336');
  const big = { ...base, label: { w: base.label.w * 2, h: base.label.h * 2 } };
  const a = layoutLabel(base, { title: 'Card Wallet', price: 'RM9.00', barcode: '12345678' }, fake);
  const b = layoutLabel(big, { title: 'Card Wallet', price: 'RM9.00', barcode: '12345678' }, fake);
  assert.ok(a.ok && b.ok);
  assert.equal(scaleOf(big), 2);
  const fa = a.elements.filter((e) => e.kind === 'text').map((e) => e.size);
  const fb = b.elements.filter((e) => e.kind === 'text').map((e) => e.size);
  fa.forEach((s, i) => assert.ok(Math.abs(fb[i] - 2 * s) < 1e-9));
  assert.ok(Math.abs(b.stats.barH - 2 * a.stats.barH) < 1e-9);
});

test('layout: barcode scale resizes only the barcode; text keeps its size', () => {
  const cfg = configFromPreset('dymo-30252');
  const d = { title: 'Card Wallet', price: 'RM9.00', barcode: '12345678' };
  const a = layoutLabel(cfg, d, fake);
  const b = layoutLabel({ ...cfg, barcode: { ...cfg.barcode, scale: 0.6 } }, d, fake);
  assert.ok(a.ok && b.ok);
  assert.deepEqual(a.elements.filter((e) => e.kind === 'text').map((e) => e.size), b.elements.filter((e) => e.kind === 'text').map((e) => e.size));
  assert.ok(b.stats.barH < a.stats.barH && b.stats.barW < a.stats.barW);
});

test('layout: a barcode that is too big blocks, never clips; maxBarcodeScale finds the fit', () => {
  const cfg = configFromPreset('dymo-30336');
  const d = { title: 'Card Wallet', price: 'RM9.00', barcode: '12345678' };
  const huge = layoutLabel({ ...cfg, barcode: { ...cfg.barcode, scale: 3 } }, d, fake);
  assert.ok(!huge.ok);
  assert.ok(huge.errors.some((e) => ['BARCODE_TOO_WIDE', 'NO_FIT_HEIGHT'].includes(e.code)));
  const best = maxBarcodeScale(cfg, [d], fake);
  assert.ok(best > 1 && best < 3);
  assert.ok(layoutLabel({ ...cfg, barcode: { ...cfg.barcode, scale: best } }, d, fake).ok);
  assert.ok(!layoutLabel({ ...cfg, barcode: { ...cfg.barcode, scale: best + 0.05 } }, d, fake).ok);
});

test('layout: long titles shrink then wrap; impossible ones block', () => {
  const cfg = configFromPreset('dymo-30336');
  const long = layoutLabel(cfg, { title: 'Brand Name Deep Hydrating Face Cream 50ml - Rose', price: 'RM9.00', barcode: '12345678' }, real);
  assert.ok(long.ok, long.errors.map((e) => e.message).join());
  const absurd = layoutLabel(cfg, { title: 'X'.repeat(200), price: 'RM9.00', barcode: '12345678' }, real);
  assert.ok(!absurd.ok && absurd.errors[0].code === 'TITLE_NO_FIT');
});

test('layout: barcode that cannot be encoded blocks', () => {
  const r = layoutLabel(configFromPreset('dymo-30336'), { title: 'A', price: 'RM1.00', barcode: 'ok é' }, fake);
  assert.ok(!r.ok && r.errors[0].code === 'BARCODE_INVALID');
});

test('rotation: the four mappings place the frame inside the label area', () => {
  for (const rotation of [0, 90, 180, 270]) {
    const cfg = { ...buildConfig({ label: { w: 26, h: 79 }, rotation }), offset: { x: 0, y: 0 } };
    const geo = pageGeometry(cfg);
    const f = frameOf(cfg.label, rotation);
    for (const [x, y] of [[0, 0], [f.w, 0], [0, f.h], [f.w, f.h]]) {
      const [px, py] = geo.map(x, y);
      assert.ok(px >= geo.label.x - 1e-6 && px <= geo.label.x + geo.label.w + 1e-6, `${rotation} x ${px}`);
      assert.ok(py >= geo.label.y - 1e-6 && py <= geo.label.y + geo.label.h + 1e-6, `${rotation} y ${py}`);
    }
  }
  // 90°: text starts at the bottom of the label and reads upward; later lines move right.
  const geo = pageGeometry(buildConfig({ label: { w: 26, h: 79 }, rotation: 90 }));
  const [x0, y0] = geo.map(0, 0);
  const [x1, y1] = geo.map(10, 5);
  assert.ok(x1 > x0 && y1 < y0);
});

test('rows: a clean row prints; the label count is the sum of quantities', () => {
  const cfg = configFromPreset('dymo-30336');
  const out = checkRows([row(), row({ id: 'r2', qty: '3', variant: variant({ variantId: 'gid://shopify/ProductVariant/2', sku: 'B' }), sku: 'B' })], cfg, real);
  assert.ok(out.ready, JSON.stringify([...out.results.values()].map((r) => r.issues)));
  assert.equal(out.totalLabels, 5);
});

test('rows: every problem blocks the whole run', () => {
  const cfg = configFromPreset('dymo-30336');
  const v = (n, o) => variant({ variantId: `gid://shopify/ProductVariant/${n}`, sku: `S${n}`, ...o });
  const cases = {
    NO_BARCODE: row({ variant: v(1, { barcode: null }) }),
    BAD_BARCODE: row({ variant: v(1, { barcode: 'abc é' }) }),
    BAD_TEXT: row({ variant: v(1, { productTitle: '钱包' }) }),
    NO_PRICE: row({ variant: v(1, { price: null }) }),
    ARCHIVED: row({ variant: v(1, { productStatus: 'ARCHIVED' }) }),
    BAD_QTY: row({ qty: '' }),
    NOT_FOUND: row({ variant: null, resolution: 'not-found' }),
    MULTIPLE: row({ variant: null, resolution: 'multiple' }),
  };
  for (const [code, r] of Object.entries(cases)) {
    const out = checkRows([r], cfg, real);
    assert.ok(!out.ready, code);
    assert.ok(out.results.get('r1').issues.some((i) => i.code.startsWith(code)), `${code}: ${JSON.stringify(out.results.get('r1').issues)}`);
  }
});

test('rows: duplicates block (same variant, even from different rows)', () => {
  const out = checkRows([row(), row({ id: 'r2' })], configFromPreset('dymo-30336'), real);
  assert.ok(!out.ready);
  assert.ok(out.results.get('r1').issues.some((i) => i.code === 'DUPLICATE'));
  assert.ok(out.results.get('r2').issues.some((i) => i.code === 'DUPLICATE'));
});

test('rows: missing price is skipped (not blocked) only when the run allows it', () => {
  const cfg = configFromPreset('dymo-30336');
  const noPrice = row({ variant: variant({ price: null }) });
  const ok = row({ id: 'r2', variant: variant({ variantId: 'gid://shopify/ProductVariant/2', sku: 'B' }), sku: 'B' });
  assert.ok(!checkRows([noPrice, ok], cfg, real).ready);
  const out = checkRows([noPrice, ok], cfg, real, { allowNoPrice: true });
  assert.ok(out.ready);
  assert.deepEqual(out.skippedRows.map((r) => r.id), ['r1']);
  assert.deepEqual(out.printable.map((p) => p.row.id), ['r2']);
  // …and a run where everything is skipped has nothing to print.
  assert.ok(!checkRows([noPrice], cfg, real, { allowNoPrice: true }).ready);
});

test('rows: price source and "no price" setting', () => {
  const cfg = { ...configFromPreset('dymo-30336'), price: { ...configFromPreset('dymo-30336').price, source: 'vendorRrp' } };
  assert.ok(!checkRows([row()], cfg, real).ready); // no vendor RRP stored
  assert.ok(checkRows([row({ variant: variant({ vendorRrp: '120' }) })], cfg, real).ready);
  const off = { ...cfg, price: { ...cfg.price, on: false } };
  assert.ok(checkRows([row()], off, real).ready); // price off → nothing to be missing
});

test('rows: over the per-run limit blocks', () => {
  const out = checkRows([row({ qty: String(MAX_LABELS_PER_RUN + 1) })], configFromPreset('dymo-30336'), real);
  assert.ok(!out.ready && out.runErrors.some((e) => e.includes('limit')));
  assert.ok(checkRows([row({ qty: String(MAX_LABELS_PER_RUN) })], configFromPreset('dymo-30336'), real).ready);
});

test('render: one page per label at the template page size', () => {
  const cfg = configFromPreset('dymo-30336');
  const layout = layoutLabel(cfg, { title: 'Card Wallet - Black', price: 'RM99.00', barcode: '30000444' }, real);
  const doc = renderLabelsPdf(cfg, [{ layout, qty: 3 }]);
  assert.equal(doc.getNumberOfPages(), 3);
  const { width, height } = doc.internal.pageSize;
  assert.ok(Math.abs(width - cfg.page.w) < 0.01 && Math.abs(height - cfg.page.h) < 0.01);
});

import { setLabelDim, applyPreset } from './configEdit.js';

test('configEdit: locked ratio keeps the label shape; unlocked does not', () => {
  const cfg = configFromPreset('dymo-30252'); // 26 × 79
  const wide = setLabelDim(cfg, 'w', 52);
  assert.equal(wide.label.w, 52);
  assert.equal(wide.label.h, 158);
  assert.equal(scaleOf(wide), 2);
  const free = setLabelDim({ ...cfg, lockRatio: false }, 'w', 52);
  assert.deepEqual(free.label, { w: 52, h: 79 });
  assert.equal(setLabelDim(cfg, 'w', 'abc'), cfg);
  assert.equal(setLabelDim(cfg, 'w', 0), cfg);
});

test('configEdit: switching label type keeps what is printed, changes the size', () => {
  const cfg = { ...configFromPreset('dymo-30252') };
  cfg.price = { ...cfg.price, source: 'vendorRrp', prefix: 'MYR ' };
  cfg.sku = { ...cfg.sku, on: true };
  const next = applyPreset(cfg, 'zebra-10010039');
  assert.deepEqual(next.label, { w: 51, h: 25 });
  assert.equal(next.price.source, 'vendorRrp');
  assert.equal(next.price.prefix, 'MYR ');
  assert.equal(next.sku.on, true);
  assert.equal(next.rotation, 0);
});
