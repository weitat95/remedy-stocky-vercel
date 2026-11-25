import apiClient from './client.js';

const unwrap = (res) => res.data.data;
const id = encodeURIComponent;

export const getTasks = (params = {}) => apiClient.get('/tasks', { params }).then(unwrap);
export const getTask = (taskId) => apiClient.get(`/tasks/${id(taskId)}`).then(unwrap);
export const getTaskSummary = () => apiClient.get('/tasks/summary').then(unwrap);
export const getAssignees = () => apiClient.get('/tasks/assignees').then(unwrap);

// body.repeat (optional) makes a repeat rule and returns { rule, created } instead of a task.
export const createTask = (body) => apiClient.post('/tasks', body).then(unwrap);
// body.scope: 'this' | 'future' (future also updates the repeat's template)
export const updateTask = (taskId, body) => apiClient.put(`/tasks/${id(taskId)}`, body).then(unwrap);
export const deleteTask = (taskId) => apiClient.delete(`/tasks/${id(taskId)}`).then(unwrap);

export const completeTask = (taskId, body = {}) => apiClient.post(`/tasks/${id(taskId)}/complete`, body).then(unwrap);
export const uncompleteTask = (taskId) => apiClient.post(`/tasks/${id(taskId)}/uncomplete`).then(unwrap);
export const reviewTask = (taskId) => apiClient.post(`/tasks/${id(taskId)}/review`).then(unwrap);
export const unreviewTask = (taskId) => apiClient.post(`/tasks/${id(taskId)}/unreview`).then(unwrap);
export const dismissTask = (taskId) => apiClient.post(`/tasks/${id(taskId)}/dismiss`).then(unwrap);

export const getRules = () => apiClient.get('/tasks/rules').then(unwrap);
export const pauseRule = (ruleId) => apiClient.post(`/tasks/rules/${id(ruleId)}/pause`).then(unwrap);
export const resumeRule = (ruleId) => apiClient.post(`/tasks/rules/${id(ruleId)}/resume`).then(unwrap);
export const endRule = (ruleId) => apiClient.post(`/tasks/rules/${id(ruleId)}/end`).then(unwrap);

// Calendar: occurrences of active repeats not created yet, for from..to (YYYY-MM-DD, up to 62 days).
export const getUpcoming = (from, to) => apiClient.get('/tasks/upcoming', { params: { from, to } }).then(unwrap);
