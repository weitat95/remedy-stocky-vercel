import apiClient from './client.js';

export async function getSuppliers() {
  const res = await apiClient.get('/suppliers');
  return res.data.data;
}

export async function getSupplier(id) {
  const res = await apiClient.get(`/suppliers/${id}`);
  return res.data.data;
}

export async function createSupplier(payload) {
  const res = await apiClient.post('/suppliers', payload);
  return res.data.data;
}

export async function updateSupplier(id, payload) {
  const res = await apiClient.put(`/suppliers/${id}`, payload);
  return res.data.data;
}

export async function deleteSupplier(id) {
  const res = await apiClient.delete(`/suppliers/${id}`);
  return res.data.data;
}
