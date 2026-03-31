import axios from 'axios';

const user = import.meta.env.VITE_API_USER || '';
const pass = import.meta.env.VITE_API_PASS || '';

// Build the Authorization header value for Basic Auth
const basicAuthHeader =
  user && pass
    ? `Basic ${btoa(`${user}:${pass}`)}`
    : undefined;

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001',
  headers: {
    'Content-Type': 'application/json',
    ...(basicAuthHeader && { Authorization: basicAuthHeader }),
  },
});

// Response interceptor — unwrap { data } envelope or throw { error }
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    const message =
      error.response?.data?.error || error.message || 'An unexpected error occurred';
    const enriched = new Error(message);
    enriched.status = error.response?.status;
    enriched.originalError = error;
    return Promise.reject(enriched);
  }
);

export default apiClient;
