import apiClient from './client.js';

export async function getTaxRates() {
  const res = await apiClient.get('/tax-rates');
  return res.data.data;
}

export async function createTaxRate(payload) {
  const res = await apiClient.post('/tax-rates', payload);
  return res.data.data;
}

export async function updateTaxRate(id, payload) {
  const res = await apiClient.put(`/tax-rates/${id}`, payload);
  return res.data.data;
}

export async function deleteTaxRate(id) {
  const res = await apiClient.delete(`/tax-rates/${id}`);
  return res.data.data;
}
