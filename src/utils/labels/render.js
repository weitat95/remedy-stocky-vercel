import { jsPDF } from 'jspdf'; // named export: the default import is a namespace object under Node (tests)
import { layoutLabel, pageGeometry } from './layout.js';

// Text width in mm for Helvetica, measured with a scratch jsPDF document.
export function makeMeasure() {
  const doc = new jsPDF({ unit: 'mm', format: [50, 50] });
  return (text, sizePt, bold = false) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(sizePt);
    return doc.getTextWidth(text);
  };
}

const orient = (p) => (p.h >= p.w ? 'p' : 'l');

// Draws one label's elements (reading-frame mm) onto the current page for the template's rotation.
function drawLabel(doc, geo, rotation, elements) {
  doc.setFillColor(0, 0, 0);
  doc.setTextColor(0, 0, 0);
  for (const el of elements) {
    if (el.kind === 'rect') {
      const [x1, y1] = geo.map(el.x, el.y);
      const [x2, y2] = geo.map(el.x + el.w, el.y + el.h);
      doc.rect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1), 'F');
    } else {
      const [x, y] = geo.map(el.x, el.y);
      doc.setFont('helvetica', el.bold ? 'bold' : 'normal');
      doc.setFontSize(el.size);
      doc.text(el.text, x, y, rotation ? { angle: rotation } : undefined);
    }
  }
}

// jobs: [{ layout, qty }] (layouts already validated). One PDF page per label, page size = the template's
// page size, so the printer driver sees exactly the paper it was set up for. `guides` outlines the
// label area (preview only).
export function renderLabelsPdf(cfg, jobs, { guides = false } = {}) {
  const geo = pageGeometry(cfg);
  const { page } = geo;
  const doc = new jsPDF({ unit: 'mm', format: [page.w, page.h], orientation: orient(page), compress: true });
  let first = true;
  for (const job of jobs) {
    for (let i = 0; i < job.qty; i++) {
      if (!first) doc.addPage([page.w, page.h], orient(page));
      first = false;
      if (guides) {
        doc.setDrawColor(160, 160, 160);
        doc.setLineWidth(0.1);
        doc.rect(geo.label.x, geo.label.y, geo.label.w, geo.label.h, 'S');
      }
      drawLabel(doc, geo, cfg.rotation, job.layout.elements);
    }
  }
  return doc;
}

// Preview: lays out one sample and renders a single page; returns { doc } or { errors }.
export function renderPreview(cfg, sampleData, measure, opts) {
  const layout = layoutLabel(cfg, sampleData, measure);
  if (!layout.ok) return { errors: layout.errors };
  return { doc: renderLabelsPdf(cfg, [{ layout, qty: 1 }], opts), layout };
}
