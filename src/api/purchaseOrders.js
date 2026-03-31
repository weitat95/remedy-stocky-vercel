import apiClient from './client.js';

export async function getPurchaseOrders(params = {}) {
  const res = await apiClient.get('/purchase-orders', { params });
  return res.data.data;
}

export async function getPurchaseOrder(id) {
  const res = await apiClient.get(`/purchase-orders/${id}`);
  return res.data.data;
}

export async function getPODetail(id) {
  const res = await apiClient.get(`/purchase-orders/${id}/detail`);
  return res.data.data;
}

export async function createPurchaseOrder(payload) {
  const res = await apiClient.post('/purchase-orders', payload);
  return res.data.data;
}

export async function updatePurchaseOrder(id, payload) {
  const res = await apiClient.put(`/purchase-orders/${id}`, payload);
  return res.data.data;
}

export async function deletePurchaseOrder(id) {
  const res = await apiClient.delete(`/purchase-orders/${id}`);
  return res.data.data;
}

export async function confirmPurchaseOrder(id) {
  const res = await apiClient.post(`/purchase-orders/${id}/confirm`);
  return res.data.data;
}

export async function clonePurchaseOrder(id) {
  const res = await apiClient.post(`/purchase-orders/${id}/clone`);
  return res.data.data;
}

export async function archivePurchaseOrder(id) {
  const res = await apiClient.put(`/purchase-orders/${id}/archive`);
  return res.data.data;
}

export async function undoReceivePO(id) {
  const res = await apiClient.post(`/purchase-orders/${id}/undo-receive`);
  return res.data.data;
}

export async function getPOLineItems(id) {
  const res = await apiClient.get(`/purchase-orders/${id}/line-items`);
  return res.data.data;
}

export async function receivePO(id, payload) {
  const res = await apiClient.post(`/purchase-orders/${id}/receive`, payload);
  return res.data.data;
}
