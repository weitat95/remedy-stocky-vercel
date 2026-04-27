import apiClient from './client.js';

export async function getAdjustmentReasons() {
  const res = await apiClient.get('/adjustment-reasons');
  return res.data.data;
}

export async function createAdjustmentReason(label) {
  const res = await apiClient.post('/adjustment-reasons', { label });
  return res.data.data;
}

export async function updateAdjustmentReason(id, label) {
  const res = await apiClient.put(`/adjustment-reasons/${id}`, { label });
  return res.data.data;
}

export async function deleteAdjustmentReason(id) {
  const res = await apiClient.delete(`/adjustment-reasons/${id}`);
  return res.data.data;
}
