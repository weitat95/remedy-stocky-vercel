import apiClient from './client.js';

export async function getVendors(params = {}) {
  const res = await apiClient.get('/vendors', { params });
  return res.data.data;
}

export async function getVendor(id) {
  const res = await apiClient.get(`/vendors/${id}`);
  return res.data.data;
}

export async function updateVendor(id, payload) {
  const res = await apiClient.put(`/vendors/${id}`, payload);
  return res.data.data;
}

export async function hideVendor(id) {
  const res = await apiClient.put(`/vendors/${id}/hide`);
  return res.data.data;
}

export async function unhideVendor(id) {
  const res = await apiClient.put(`/vendors/${id}/unhide`);
  return res.data.data;
}

export async function getVendorUsage(id) {
  const res = await apiClient.get(`/vendors/${id}/usage`);
  return res.data.data;
}

export async function convertToSupplier(id) {
  const res = await apiClient.put(`/vendors/${id}/convert_to_supplier`);
  return res.data.data;
}
