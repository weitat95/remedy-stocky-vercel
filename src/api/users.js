import apiClient from './client.js';

export async function getUsers() {
  const res = await apiClient.get('/users');
  return res.data.data;
}

export async function createUser(payload) {
  const res = await apiClient.post('/users', payload);
  return res.data.data;
}

// Any subset of { displayName, role, kind, active, locationIds, password }.
export async function updateUser(id, payload) {
  const res = await apiClient.put(`/users/${encodeURIComponent(id)}`, payload);
  return res.data.data;
}
