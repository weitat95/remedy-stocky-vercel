import apiClient from './client.js';

export async function getProducts(params = {}) {
  const res = await apiClient.get('/products', { params });
  return res.data.data; // { products, pageInfo, shopifyAdminBase }
}

export async function importVariantMeta(records) {
  const res = await apiClient.post('/products/meta/bulk', records);
  return res.data.data; // { imported }
}

// records: [{ shopifyVariantId, locationId, maxStock }] — Max Qty is per
// (variant, location), not part of VariantMeta. Used by the Max Quantity page.
export async function importVariantLocationMaxStock(records) {
  const res = await apiClient.post('/products/meta/max-stock/bulk', records);
  return res.data.data; // { imported }
}

export async function exportProducts(params = {}) {
  const res = await apiClient.get('/products/export', { params });
  return res.data.data; // { products }
}
