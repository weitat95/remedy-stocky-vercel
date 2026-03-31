import apiClient from './client.js';

export async function getForecasting(params = {}) {
  const res = await apiClient.get('/inventory/forecasting', { params });
  return res.data;
}

export async function getInventoryLevels(params = {}) {
  const res = await apiClient.get('/inventory/levels', { params });
  return res.data;
}

export async function getLocations() {
  const res = await apiClient.get('/inventory/locations');
  return res.data;
}

export async function getProducts() {
  const res = await apiClient.get('/inventory/products');
  return res.data;
}

export async function getOrders(params = {}) {
  const res = await apiClient.get('/inventory/orders', { params });
  return res.data;
}

export async function adjustInventory(payload) {
  const res = await apiClient.post('/inventory/adjust', payload);
  return res.data;
}
