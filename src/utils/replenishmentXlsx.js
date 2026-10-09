// Excel export for the Replenishment report. Layout mirrors the client's hand-formatted
// sheet: meta lines (rows 1-4), optional filters (row 5), merged + tinted store bands
// (row 6), headings (row 7), data from row 8, panes frozen below the headings.

const STORE_TINTS = ['FFCFECFA', 'FFDCEDD5', 'FFFCE4D6', 'FFE9DDF5', 'FFFFF2CC'];
const SUMMARY_TINT = 'FFEDEDED';
const DASH = '—';

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
 * @param {string} opts.summaryLabel  band over Total REPL / Cl. Bal ("All stores" | "Source")
 * @param {Array<object>} opts.lineItems  normalized line items (see normalizeLineItem)
 */
export async function downloadReplenishmentXlsx({ filename, sheetTitle, meta, dests, summaryLabel, lineItems }) {
  // Lazy-loaded: exceljs is large and only needed when someone exports.
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName(sheetTitle));

  const num = (v) => (v === null || v === undefined || v === '' ? DASH : v);

  meta.forEach(([label, value], i) => {
    ws.getCell(i + 1, 1).value = label;
    ws.getCell(i + 1, 2).value = value;
    ws.getCell(i + 1, 1).font = { bold: true };
  });

  const BAND_ROW = 6;
  const HEAD_ROW = 7;
  const FIRST_COL_FIXED = 5; // Vendor, SKU, Product, Variant, Op. Bal
  const perStore = ['Max Qty', 'Sold Qty', 'Dest Qty', 'REPL QTY'];

  const headings = ['Vendor', 'SKU', 'Product', 'Variant', 'Op. Bal'];
  dests.forEach(() => headings.push(...perStore));
  headings.push('Total REPL', 'Cl. Bal');
  ws.getRow(HEAD_ROW).values = headings;
  ws.getRow(HEAD_ROW).font = { bold: true };
  ws.getRow(HEAD_ROW).alignment = { horizontal: 'center' };

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
  band(summaryStart, summaryStart + 1, summaryLabel, SUMMARY_TINT);

  lineItems.forEach((li, i) => {
    const row = [li.vendor, li.sku, li.productTitle, li.variantTitle, num(li.sourceQty)];
    dests.forEach((d) => {
      const p = li.perDest[d.id] || {};
      row.push(num(p.maxStock), num(p.soldQty), num(p.destQty), num(p.replQty));
    });
    row.push(num(li.replTotal), num(li.endStock));
    ws.getRow(HEAD_ROW + 1 + i).values = row.map((v) => (v === undefined || v === null ? '' : v));
  });

  // Numeric columns centered; dash placeholders stay readable.
  for (let c = FIRST_COL_FIXED; c < summaryStart + 2; c++) {
    ws.getColumn(c).alignment = { horizontal: 'center' };
  }
  [15.5, 24, 46, 24].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  for (let c = FIRST_COL_FIXED; c < summaryStart + 2; c++) ws.getColumn(c).width = 9;
  ws.getColumn(summaryStart).width = 11;
  ws.getColumn(1).alignment = { horizontal: 'left' };

  ws.views = [{ state: 'frozen', ySplit: HEAD_ROW }];
  ws.autoFilter = { from: { row: HEAD_ROW, column: 1 }, to: { row: HEAD_ROW, column: summaryStart + 1 } };

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
