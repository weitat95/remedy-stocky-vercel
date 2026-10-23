// Excel export for the Replenishment report. Layout mirrors the client's hand-formatted
// sheet: meta lines (rows 1-4), optional filters (A5:D5), live SUBTOTAL row (row 5, from column E),
// merged + tinted store bands (row 6), headings (row 7), data from row 8, panes frozen below the headings.

const STORE_TINTS = ['FFCFECFA', 'FFDCEDD5', 'FFFCE4D6', 'FFE9DDF5', 'FFFFF2CC'];
const SUMMARY_TINT = 'FFEDEDED';

function sheetName(s) {
  // Excel: max 31 chars, none of : \ / ? * [ ]
  return s.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
}

/**
 * @param {object} opts
 * @param {string} opts.filename
 * @param {string} opts.sheetTitle
 * @param {Array<[string, string]>} opts.meta   label/value rows for the top block (max 5)
 * @param {Array<{id:string,name:string}>} opts.dests  destination stores, in allocation order
 * @param {Array<object>} opts.lineItems  normalized line items (see normalizeLineItem)
 */
export async function downloadReplenishmentXlsx({ filename, sheetTitle, meta, dests, lineItems }) {
  // Lazy-loaded: exceljs is large and only needed when someone exports.
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName(sheetTitle));

  // Unset / untracked values stay truly empty (no placeholder text), so formulas and filters treat them as blank.
  const num = (v) => (v === null || v === undefined || v === '' ? null : v);

  meta.forEach(([label, value], i) => {
    ws.getCell(i + 1, 1).value = label;
    ws.getCell(i + 1, 2).value = value;
    ws.getCell(i + 1, 1).font = { bold: true };
  });
  // Row 5 also carries the subtotals (from column E), so a Filters line must fit inside A:D.
  if (meta.length > 4) {
    ws.mergeCells(5, 2, 5, 4);
    ws.getCell(5, 2).alignment = { shrinkToFit: true };
  }

  const SUBTOTAL_ROW = 5;
  const BAND_ROW = 6;
  const HEAD_ROW = 7;
  const FIRST_COL_FIXED = 5; // Vendor, SKU, Product, Variant, Op. Bal
  // Store Qty appears twice: before replenishment (as in Shopify) and after adding REPL QTY.
  const perStore = ['Max Qty', 'Sold Qty', 'Store Qty', 'REPL QTY', 'Store Qty'];
  const CLOSING_HEADING = 'WH';

  const headings = ['Vendor', 'SKU', 'Product', 'Variant', 'Op. Bal'];
  dests.forEach(() => headings.push(...perStore));
  headings.push('Total REPL', CLOSING_HEADING);
  ws.getRow(HEAD_ROW).values = headings;
  ws.getRow(HEAD_ROW).font = { bold: true };
  ws.getRow(HEAD_ROW).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  ws.getRow(HEAD_ROW).height = 30;

  const band = (startCol, endCol, label, argb) => {
    ws.mergeCells(BAND_ROW, startCol, BAND_ROW, endCol);
    const cell = ws.getCell(BAND_ROW, startCol);
    cell.value = label;
    cell.font = { bold: true };
    cell.alignment = { horizontal: 'center' };
    for (let c = startCol; c <= endCol; c++) {
      ws.getCell(BAND_ROW, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
      ws.getCell(HEAD_ROW, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    }
  };
  dests.forEach((d, i) => {
    const start = FIRST_COL_FIXED + 1 + i * perStore.length;
    band(start, start + perStore.length - 1, d.name, STORE_TINTS[i % STORE_TINTS.length]);
  });
  const summaryStart = FIRST_COL_FIXED + 1 + dests.length * perStore.length;
  band(summaryStart, summaryStart + 1, 'Warehouse', SUMMARY_TINT);
  // Op. Bal is warehouse stock, so it gets its own (untinted) Warehouse band.
  ws.getCell(BAND_ROW, FIRST_COL_FIXED).value = 'Warehouse';
  ws.getCell(BAND_ROW, FIRST_COL_FIXED).font = { bold: true };
  ws.getCell(BAND_ROW, FIRST_COL_FIXED).alignment = { horizontal: 'center' };

  const colLetter = (c) => ws.getColumn(c).letter;
  const firstData = HEAD_ROW + 1;
  const lastData = HEAD_ROW + lineItems.length;
  const builtRows = [];
  lineItems.forEach((li, i) => {
    const r = firstData + i;
    const opBal = li.sourceQty;
    const row = [li.vendor, li.sku, li.productTitle, li.variantTitle, num(opBal)];
    dests.forEach((d) => {
      const p = li.perDest[d.id] || {};
      row.push(num(p.maxStock), num(p.soldQty), num(p.destQty), num(p.replQty));
      // Store Qty after replenishment: blank when the warehouse has nothing (Op. Bal 0 / empty) or there is no REPL figure.
      const storeCol = colLetter(row.length - 1);
      const replCol = colLetter(row.length);
      const blank = !opBal || typeof p.replQty !== 'number';
      row.push({
        formula: `IF(OR(N($E${r})=0,NOT(ISNUMBER(${replCol}${r}))),"",N(${storeCol}${r})+${replCol}${r})`,
        result: blank ? '' : (p.destQty ?? 0) + p.replQty,
      });
    });
    row.push(num(li.replTotal), num(li.endStock));
    builtRows.push(row);
    ws.getRow(r).values = row.map((v) => (v === undefined ? null : v));
  });

  // Live subtotals over the calculated columns (follow the filter; text placeholders are ignored).
  if (lineItems.length) {
    const sumCol = (c) => {
      const L = colLetter(c);
      const cell = ws.getCell(SUBTOTAL_ROW, c);
      // Cached result so viewers that don't recalculate still show a figure; Excel recomputes on open.
      const result = builtRows.reduce((sum, row) => {
        const v = row[c - 1];
        const n = typeof v === 'object' && v !== null ? v.result : v;
        return typeof n === 'number' ? sum + n : sum;
      }, 0);
      cell.value = { formula: `SUBTOTAL(9,${L}${firstData}:${L}${lastData})`, result };
      cell.font = { bold: true };
      cell.alignment = { horizontal: 'center' };
    };
    sumCol(FIRST_COL_FIXED); // Op. Bal
    dests.forEach((_, i) => {
      const start = FIRST_COL_FIXED + 1 + i * perStore.length;
      for (let k = 1; k < perStore.length; k++) sumCol(start + k); // everything but Max Qty
    });
    sumCol(summaryStart);
    sumCol(summaryStart + 1);
  }

  // Numeric columns centered.
  for (let c = FIRST_COL_FIXED; c < summaryStart + 2; c++) {
    ws.getColumn(c).alignment = { horizontal: 'center' };
  }
  [15.5, 24, 46, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let c = FIRST_COL_FIXED; c < summaryStart + 2; c++) ws.getColumn(c).width = 9;
  ws.getColumn(summaryStart).width = 11;
  ws.getColumn(1).alignment = { horizontal: 'left' };

  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW }];
  ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: Math.max(lastData, HEAD_ROW), column: summaryStart + 1 } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
