import axios from 'axios';

// Auth is a session cookie set by POST /auth/login (httpOnly — not readable or
// settable from JS). No credentials are baked into this bundle.
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Response interceptor — unwrap { data } envelope or throw { error }
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Session missing/expired — tell the app to drop back to the login screen.
      window.dispatchEvent(new Event('auth:unauthorized'));
    }
    const message =
      error.response?.data?.error || error.message || 'An unexpected error occurred';
    const enriched = new Error(message);
    enriched.status = error.response?.status;
    enriched.originalError = error;
    return Promise.reject(enriched);
  }
);

export default apiClient;
