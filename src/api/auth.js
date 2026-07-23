import apiClient from './client.js';

export async function login(username, password) {
  const res = await apiClient.post('/auth/login', { username, password });
  return res.data.data;
}

export async function logout() {
  const res = await apiClient.post('/auth/logout');
  return res.data.data;
}

export async function getMe() {
  const res = await apiClient.get('/auth/me');
  return res.data.data;
}
