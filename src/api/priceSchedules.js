import apiClient from './client.js';

// All functions return the unwrapped { data } payload.
export async function previewPriceSchedules(rows) {
  const res = await apiClient.post('/price-schedules/preview', { rows });
  return res.data.data; // { rows, writeAccess }
}

export async function createPriceSchedules(payload) {
  const res = await apiClient.post('/price-schedules', payload);
  return res.data.data; // { batchId, count }
}

export async function getPriceSchedules(params) {
  const res = await apiClient.get('/price-schedules', { params });
  return res.data.data; // { rows, total, page, pageSize }
}

export async function getPriceSchedulesSummary() {
  const res = await apiClient.get('/price-schedules/summary');
  return res.data.data;
}

export async function setPriceSchedulerPaused(paused) {
  const res = await apiClient.put('/price-schedules/settings', { paused });
  return res.data.data;
}

export async function getPriceScheduleBatches() {
  const res = await apiClient.get('/price-schedules/batches');
  return res.data.data;
}

export async function getPriceScheduleEvents(id) {
  const res = await apiClient.get(`/price-schedules/${id}/events`);
  return res.data.data;
}

export async function getPriceScheduleBatchEvents(batchId) {
  const res = await apiClient.get(`/price-schedules/batches/${batchId}/events`);
  return res.data.data;
}

export async function getPriceScheduleBatchOriginals(batchId) {
  const res = await apiClient.get(`/price-schedules/batches/${batchId}/originals`);
  return res.data.data;
}

// action: cancel | restore-now | retry | restore-anyway | dismiss
export async function priceScheduleRowAction(id, action) {
  const res = await apiClient.post(`/price-schedules/${id}/${action}`);
  return res.data.data;
}

// action: cancel | restore-now | retry-failed | recheck
export async function priceScheduleBatchAction(batchId, action) {
  const res = await apiClient.post(`/price-schedules/batches/${batchId}/${action}`);
  return res.data.data;
}
