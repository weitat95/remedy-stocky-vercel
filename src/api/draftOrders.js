import apiClient from './client.js';

export async function createDraftOrder(lineItems) {
  const res = await apiClient.post('/draft-orders', { lineItems });
  return res.data.data;
}
