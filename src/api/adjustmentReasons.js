import apiClient from './client.js';

export async function getAdjustmentReasons() {
  const res = await apiClient.get('/adjustment-reasons');
  return res.data.data;
}

export async function createAdjustmentReason(code, label) {
  const res = await apiClient.post('/adjustment-reasons', { code, label });
  return res.data.data;
}

export async function updateAdjustmentReason(id, code, label) {
  const res = await apiClient.put(`/adjustment-reasons/${id}`, { code, label });
  return res.data.data;
}

export async function deleteAdjustmentReason(id) {
  const res = await apiClient.delete(`/adjustment-reasons/${id}`);
  return res.data.data;
}

export async function reorderAdjustmentReasons(ids) {
  const res = await apiClient.put('/adjustment-reasons/reorder', { ids });
  return res.data.data;
}
