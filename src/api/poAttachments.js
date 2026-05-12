import apiClient from './client.js';

export async function getPOAttachments(poId) {
  const res = await apiClient.get(`/purchase-orders/${poId}/attachments`);
  return { attachments: res.data.data, r2Configured: res.data.r2Configured ?? true };
}

export async function uploadPOAttachment(poId, file) {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiClient.post(`/purchase-orders/${poId}/attachments`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return res.data.data;
}

export async function deletePOAttachment(poId, attachmentId) {
  const res = await apiClient.delete(`/purchase-orders/${poId}/attachments/${attachmentId}`);
  return res.data.data;
}
