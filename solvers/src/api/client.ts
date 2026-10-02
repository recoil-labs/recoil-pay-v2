import axios from 'axios';
import type { ApiError } from '../types/api';

// Prefer the env-configured base URL (production aggregator), fall through
// to the Vite dev-server proxy (empty string → relative path) when running
// locally. The historical whitelist for `admin.recoilpay.com` is
// gone — the dashboard now talks to the live OIF aggregator at
// api.recoilpay.com.
const getApiBaseUrl = () => {
    const envUrl = import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_OIF_API_BASE_URL;
    return envUrl || '';
};

export const apiClient = axios.create({
    baseURL: getApiBaseUrl(),
    withCredentials: true,
    headers: {
        'Content-Type': 'application/json',
    },
});

apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem('auth_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('auth_token');
            if (!window.location.pathname.startsWith('/login')) {
                window.location.href = '/login';
            }
        }

        const apiError: ApiError = error.response?.data || {
            error: error.message || 'Network error',
            code: 'NETWORK_ERROR',
        };

        return Promise.reject(apiError);
    }
);
