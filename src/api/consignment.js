import apiClient from './client.js';

export async function getVendorMargins(vendorId) {
  const res = await apiClient.get('/consignment/margins', { params: { vendorId } });
  return res.data.data;
}

export async function saveVendorMargin(payload) {
  const res = await apiClient.put('/consignment/margins', payload);
  return res.data.data;
}

export async function deleteVendorMargin(id) {
  const res = await apiClient.delete(`/consignment/margins/${id}`);
  return res.data.data;
}

export async function previewRrpFill(params) {
  const res = await apiClient.get('/consignment/rrp-fill', { params });
  return res.data.data; // { rows, skippedNoCost }
}

export async function applyRrpFill(payload) {
  const res = await apiClient.post('/consignment/rrp-fill', payload);
  return res.data.data; // { filled, skippedNoCost }
}

export async function getVendorVariants(vendorId) {
  const res = await apiClient.get('/consignment/vendor-variants', { params: { vendorId } });
  return res.data.data; // [{ variantId, sku, productTitle, variantTitle, productStatus, price, unitCost, vendorRrp }]
}

export async function getTemplates() {
  const res = await apiClient.get('/consignment/templates');
  return res.data; // { data: templates[], timeFrames: [{ value, label }] }
}

export async function createTemplate(payload) {
  const res = await apiClient.post('/consignment/templates', payload);
  return res.data.data;
}

export async function updateTemplate(id, payload) {
  const res = await apiClient.put(`/consignment/templates/${id}`, payload);
  return res.data.data;
}

export async function deleteTemplate(id) {
  const res = await apiClient.delete(`/consignment/templates/${id}`);
  return res.data.data;
}

// Returns { blob, filename }. On failure the error body arrives as a Blob, so unwrap it.
async function downloadBlobRequest(url, format, extra = {}) {
  try {
    const res = await apiClient.post(url, { format, ...extra }, { responseType: 'blob' });
    const cd = res.headers['content-disposition'] || '';
    const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
    const plain = /filename="([^"]+)"/i.exec(cd);
    return { blob: res.data, filename: star ? decodeURIComponent(star[1]) : plain ? plain[1] : `consignment.${format}` };
  } catch (err) {
    if (err.response?.data instanceof Blob) {
      try { err.message = JSON.parse(await err.response.data.text()).error || err.message; } catch { /* keep message */ }
    }
    throw err;
  }
}

export async function exportTemplate(id, format) {
  return downloadBlobRequest(`/consignment/templates/${id}/export`, format);
}

export async function previewTemplate(id) {
  const res = await apiClient.post(`/consignment/templates/${id}/preview`);
  return res.data.data;
}

export async function sendTemplateNow(id) {
  const res = await apiClient.post(`/consignment/templates/${id}/send`);
  return res.data.data; // the run record: { status: 'sent'|'failed'|'skipped', error, skippedReason, missingRrpSkus, ... }
}

export async function getTemplateRuns(id) {
  const res = await apiClient.get(`/consignment/templates/${id}/runs`);
  return res.data.data;
}

// Re-download a sent report from its stored snapshot.
export async function exportRun(id, format) {
  return downloadBlobRequest(`/consignment/runs/${id}/export`, format);
}

// Report 2 — Sales by Vendor Monthly. params: { vendorId, month: 'YYYY-MM', locationId? }
export async function getSalesByVendor(params) {
  const res = await apiClient.post('/consignment/sales-by-vendor', params);
  return res.data.data;
}

export async function exportSalesByVendor(params) {
  return downloadBlobRequest('/consignment/sales-by-vendor/export', 'xlsx', params);
}
