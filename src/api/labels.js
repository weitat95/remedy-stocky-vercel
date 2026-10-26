import apiClient from './client.js';

// POST /labels/variants → { shopifyAdminBase, variants: [{ variantId, productId, sku, productTitle,
// variantTitle, productStatus, vendor, barcode, price, compareAtPrice, vendorRrp }] }.
// Chunked client-side so one big CSV doesn't hit the per-request cap.
const CHUNK = 400;
export async function getLabelVariants(variantIds) {
  const ids = [...new Set(variantIds)];
  let shopifyAdminBase = '';
  const variants = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await apiClient.post('/labels/variants', { variantIds: ids.slice(i, i + CHUNK) });
    shopifyAdminBase = res.data.data.shopifyAdminBase;
    variants.push(...res.data.data.variants);
  }
  return { shopifyAdminBase, variants };
}

export async function getLabelTemplates() {
  const res = await apiClient.get('/labels/templates');
  return res.data.data;
}

export async function createLabelTemplate(payload) {
  const res = await apiClient.post('/labels/templates', payload);
  return res.data.data;
}

export async function updateLabelTemplate(id, payload) {
  const res = await apiClient.put(`/labels/templates/${id}`, payload);
  return res.data.data;
}

export async function deleteLabelTemplate(id) {
  const res = await apiClient.delete(`/labels/templates/${id}`);
  return res.data.data;
}
