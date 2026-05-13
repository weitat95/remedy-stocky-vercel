import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// Store "Bill to" info — configure via frontend .env
const STORE_NAME    = import.meta.env.VITE_STORE_BILL_TO_NAME    || '';
const STORE_ADDR1   = import.meta.env.VITE_STORE_BILL_TO_ADDR1   || '';
const STORE_ADDR2   = import.meta.env.VITE_STORE_BILL_TO_ADDR2   || '';
const STORE_COUNTRY = import.meta.env.VITE_STORE_BILL_TO_COUNTRY || '';
const STORE_PHONE   = import.meta.env.VITE_STORE_PHONE           || '';
const STORE_EMAIL   = import.meta.env.VITE_STORE_EMAIL           || '';

// All toggleable columns in order. 'product' is always shown and not listed here.
export const PDF_COLUMNS = [
  { key: 'sku',      label: 'SKU',      width: 32, align: 'left'  },
  { key: 'received', label: 'Received', width: 35, align: 'left'  },
  { key: 'qty',      label: 'QTY',      width: 14, align: 'right' },
  { key: 'cost',     label: 'Cost',     width: 16, align: 'right' },
  { key: 'total',    label: 'Total',    width: 18, align: 'right' },
];

export const PDF_SECTIONS = [
  { key: 'addresses',   label: 'Bill to / Ship to addresses' },
  { key: 'totalsBlock', label: 'Totals summary'              },
  { key: 'notes',       label: 'PO Notes'                    },
];

export const DEFAULT_PDF_CONFIG = {
  // columns
  sku: true, received: true, qty: true, cost: true, total: true,
  // sections
  addresses: true, totalsBlock: true, notes: true,
};

function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtDatetime(d) {
  if (!d) return '';
  return new Date(d).toLocaleString('en-MY', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function computeTotals(po) {
  const items = po.lineItems || [];
  const subtotal = items.reduce((s, li) => s + parseFloat(li.costPrice || 0) * li.quantity, 0);
  const tax = items.reduce((s, li) => {
    return s + parseFloat(li.costPrice || 0) * li.quantity * (parseFloat(li.taxRate || 0) / 100);
  }, 0);
  const adjustments = parseFloat(po.adjustments || 0);
  const shipping = parseFloat(po.shippingCost || 0);
  return { subtotal, tax, adjustments, shipping, total: subtotal + tax + adjustments + shipping };
}

function buildPODoc(po, cfg = DEFAULT_PDF_CONFIG) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210;
  const mL = 14;
  const mR = 14;

  // Active columns (product always first)
  const activeCols = PDF_COLUMNS.filter((c) => cfg[c.key] !== false);

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(`PURCHASE ORDER ${po.poNumber}`, pageW - mR, 20, { align: 'right' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  const poDate = fmtDateShort(po.orderedAt || po.createdAt);
  doc.text(`${po.supplier?.name || ''} · ${poDate}`, pageW - mR, 27, { align: 'right' });

  doc.setLineWidth(0.3);
  doc.setDrawColor(180, 180, 180);
  doc.line(mL, 32, pageW - mR, 32);

  // ── Addresses ───────────────────────────────────────────────────────────────
  let tableStartY;

  if (cfg.addresses !== false) {
    const col2X = mL + (pageW - mL - mR) / 2;
    let y = 40;

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('Bill to:', mL, y);
    doc.setFont('helvetica', 'normal');

    const billLines = [
      STORE_NAME, STORE_ADDR1, STORE_ADDR2, STORE_COUNTRY,
      STORE_PHONE ? `Phone: ${STORE_PHONE}` : null,
      STORE_EMAIL ? `Email: ${STORE_EMAIL}` : null,
    ].filter(Boolean);
    billLines.forEach((line, i) => doc.text(line, mL, y + 5 + i * 5));

    doc.setFont('helvetica', 'bold');
    doc.text('Ship to:', col2X, y);
    doc.setFont('helvetica', 'normal');

    const loc = po.receiveLocation;
    const shipLines = [loc?.name || po.receiveLocationName, loc?.city, loc?.country].filter(Boolean);
    shipLines.forEach((line, i) => doc.text(line, col2X, y + 5 + i * 5));

    tableStartY = y + 5 + Math.max(billLines.length, shipLines.length) * 5 + 8;
  } else {
    tableStartY = 40;
  }

  // ── Line items table ─────────────────────────────────────────────────────────
  const groups = {};
  for (const li of (po.lineItems || [])) {
    const key = li.productVendor || 'Other items';
    if (!groups[key]) groups[key] = [];
    groups[key].push(li);
  }

  const totalColCount = 1 + activeCols.length; // product + active

  const tableBody = [];
  for (const [vendor, items] of Object.entries(groups)) {
    tableBody.push([{
      content: vendor,
      colSpan: totalColCount,
      styles: { fontStyle: 'bold', fillColor: [255, 255, 255], cellPadding: { top: 4, bottom: 4, left: 3, right: 3 } },
    }]);
    for (const li of items) {
      const variant = li.variantTitle && li.variantTitle !== 'Default Title' ? li.variantTitle : null;
      const name = variant ? `${li.productTitle} - ${variant}` : (li.productTitle || li.shopifyVariantId);

      const colValues = {
        sku:      li.sku || '',
        received: li.receivedAt ? fmtDatetime(li.receivedAt) : '',
        qty:      li.quantity,
        cost:     li.costPrice != null ? parseFloat(li.costPrice).toFixed(2) : '',
        total:    li.costPrice != null ? (parseFloat(li.costPrice) * li.quantity).toFixed(2) : '',
      };

      tableBody.push([name, ...activeCols.map((c) => colValues[c.key])]);
    }
  }

  // Build columnStyles dynamically based on active columns
  const columnStyles = { 0: { cellWidth: 'auto' } };
  activeCols.forEach((col, i) => {
    columnStyles[i + 1] = {
      cellWidth: col.width,
      ...(col.align === 'right' ? { halign: 'right' } : {}),
    };
  });

  autoTable(doc, {
    startY: tableStartY,
    head: [['Product', ...activeCols.map((c) => c.label)]],
    body: tableBody,
    theme: 'plain',
    styles: { fontSize: 8.5, cellPadding: 3, overflow: 'linebreak' },
    headStyles: {
      fontStyle: 'normal',
      lineWidth: { top: 0.3, bottom: 0.3 },
      lineColor: [180, 180, 180],
    },
    columnStyles,
    margin: { left: mL, right: mR },
  });

  // ── Totals ───────────────────────────────────────────────────────────────────
  let ty = doc.lastAutoTable.finalY + 6;

  if (cfg.totalsBlock !== false) {
    const totals = computeTotals(po);
    const totalItems = (po.lineItems || []).reduce((s, li) => s + li.quantity, 0);
    const totalsRight = pageW - mR;
    const labelRight = totalsRight - 22;

    const summaryRows = [
      ['Total Items', String(totalItems)],
      ['Sub Total', totals.subtotal.toFixed(2)],
      ['Shipping', totals.shipping > 0 ? totals.shipping.toFixed(2) : ''],
      ['Tax', totals.tax.toFixed(2)],
    ];

    doc.setFontSize(8.5);
    for (const [label, value] of summaryRows) {
      doc.setFont('helvetica', 'normal');
      doc.text(label, labelRight, ty, { align: 'right' });
      doc.text(value, totalsRight, ty, { align: 'right' });
      ty += 6;
    }

    doc.setLineWidth(0.3);
    doc.setDrawColor(180, 180, 180);
    doc.line(labelRight - 28, ty - 1, totalsRight, ty - 1);

    doc.setFont('helvetica', 'bold');
    doc.text('Total', labelRight, ty + 5, { align: 'right' });
    doc.text(totals.total.toFixed(2), totalsRight, ty + 5, { align: 'right' });

    ty += 16;
  }

  // ── PO Notes ─────────────────────────────────────────────────────────────────
  if (cfg.notes !== false && po.poNotes) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text('Notes', mL, ty);
    doc.setFont('helvetica', 'normal');
    const wrapped = doc.splitTextToSize(po.poNotes, pageW - mL - mR);
    doc.text(wrapped, mL, ty + 6);
  }

  return doc;
}

export function downloadPOPdf(po, cfg) {
  buildPODoc(po, cfg).save(`PO-${po.poNumber}.pdf`);
}

export function getPOPdfBase64(po, cfg) {
  return buildPODoc(po, cfg).output('datauristring').split(',')[1];
}
