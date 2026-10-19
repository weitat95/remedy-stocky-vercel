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
