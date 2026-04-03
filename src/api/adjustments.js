import apiClient from './client.js';

export async function getAdjustments(params = {}) {
  const res = await apiClient.get('/adjustments', { params });
  return res.data.data; // { adjustments, pageInfo }
}

export async function getAdjustment(id) {
  const res = await apiClient.get(`/adjustments/${id}`);
  return res.data.data;
}

export async function createAdjustment(body) {
  const res = await apiClient.post('/adjustments', body);
  return res.data.data;
}

export async function updateAdjustment(id, body) {
  const res = await apiClient.put(`/adjustments/${id}`, body);
  return res.data.data;
}

export async function deleteAdjustment(id) {
  const res = await apiClient.delete(`/adjustments/${id}`);
  return res.data.data;
}

export async function saveAdjustment(id, body) {
  const res = await apiClient.post(`/adjustments/${id}/save`, body);
  return res.data.data;
}

export async function getInventoryLevel(inventoryItemId, locationId) {
  const res = await apiClient.get('/adjustments/inventory-level', {
    params: { inventoryItemId, locationId },
  });
  return res.data.data.qty; // null if not stocked at location, number otherwise
}

export async function archiveAdjustment(id) {
  const res = await apiClient.put(`/adjustments/${id}/archive`);
  return res.data.data;
}
