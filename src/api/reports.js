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

export async function getLocationDailySales(params = {}) {
  const res = await apiClient.get('/reports/location-daily-sales', { params });
  return res.data;
}

export async function getReplenishmentReports(params = {}) {
  const res = await apiClient.get('/reports/replenishment', { params });
  return res.data;
}

export async function getReplenishmentReport(id) {
  const res = await apiClient.get(`/reports/replenishment/${id}`);
  return res.data;
}

export async function runReplenishmentReport(body) {
  const res = await apiClient.post('/reports/replenishment/run', body);
  return res.data;
}

export async function getReplenishmentSettings() {
  const res = await apiClient.get('/reports/replenishment/settings');
  return res.data;
}

export async function updateReplenishmentSettings(body) {
  const res = await apiClient.put('/reports/replenishment/settings', body);
  return res.data;
}
