import apiClient from './client.js';

export async function getSlowMoving(params = {}) {
  const res = await apiClient.get('/reports/slow-moving', { params });
  return res.data;
}

export async function getReorderReport(params = {}) {
  const res = await apiClient.get('/reports/reorder', { params });
  return res.data;
}

export async function getPOHistory() {
  const res = await apiClient.get('/reports/po-history');
  return res.data;
}

export async function getStockOnHand() {
  const res = await apiClient.get('/reports/stock-on-hand');
  return res.data;
}
