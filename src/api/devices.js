import apiClient from './client.js';

// GET /devices → { devices: [...], locations: [{ id, name }] }
export async function getDevices() {
  const res = await apiClient.get('/devices');
  return res.data.data;
}

export async function createDevice(payload) {
  const res = await apiClient.post('/devices', payload);
  return res.data.data;
}

// deviceId in the URL is the current id; payload may include a new deviceId to rename.
export async function updateDevice(deviceId, payload) {
  const res = await apiClient.put(`/devices/${encodeURIComponent(deviceId)}`, payload);
  return res.data.data;
}

export async function deleteDevice(deviceId) {
  const res = await apiClient.delete(`/devices/${encodeURIComponent(deviceId)}`);
  return res.data.data;
}
