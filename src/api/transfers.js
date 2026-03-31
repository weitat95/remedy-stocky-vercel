import apiClient from './client.js';

export async function getTransfers(params = {}) {
  const res = await apiClient.get('/transfers', { params });
  return res.data.data;
}

export async function getTransfer(id) {
  const res = await apiClient.get(`/transfers/${id}`);
  return res.data.data;
}

export async function createTransfer(payload) {
  const res = await apiClient.post('/transfers', payload);
  return res.data.data;
}

export async function updateTransfer(id, payload) {
  const res = await apiClient.put(`/transfers/${id}`, payload);
  return res.data.data;
}

export async function deleteTransfer(id) {
  const res = await apiClient.delete(`/transfers/${id}`);
  return res.data.data;
}

/**
 * Confirm and execute a transfer via Shopify.
 * @param {string} id - Transfer ID
 * @param {{ fulfillmentOrderId?: string }} [payload]
 */
export async function confirmTransfer(id, payload = {}) {
  const res = await apiClient.post(`/transfers/${id}/confirm`, payload);
  return res.data.data;
}
