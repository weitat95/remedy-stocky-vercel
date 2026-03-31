import apiClient from './client.js';

export async function getProducts(params = {}) {
  const res = await apiClient.get('/products', { params });
  return res.data.data; // { products, pageInfo, shopifyAdminBase }
}

export async function importVariantMeta(records) {
  const res = await apiClient.post('/products/meta/bulk', records);
  return res.data.data; // { imported }
}
