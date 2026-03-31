import apiClient from './client.js';

export async function getOrders(params = {}) {
  const res = await apiClient.get('/orders', { params });
  return res.data.data; // { orders, pageInfo, createOrderUrl }
}

export async function linkPO(numericOrderId, purchaseOrderId) {
  const res = await apiClient.post(`/orders/${numericOrderId}/link`, { purchaseOrderId });
  return res.data.data;
}

export async function unlinkPO(numericOrderId, purchaseOrderId) {
  const res = await apiClient.delete(`/orders/${numericOrderId}/link/${purchaseOrderId}`);
  return res.data.data;
}
