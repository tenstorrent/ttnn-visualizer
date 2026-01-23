// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import getServerConfig from '../functions/getServerConfig';
import ENDPOINTS from '../definitions/Endpoints';

const serverConfig = getServerConfig();
const baseURL = serverConfig?.BASE_PATH;

const axiosInstance = axios.create({
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    baseURL,
});

export const getOrCreateInstanceId = () => {
    const urlInstanceId = new URLSearchParams(window.location.search).get('instanceId');
    let instanceId = sessionStorage.getItem('instanceId');

    if (urlInstanceId) {
        instanceId = urlInstanceId;
        sessionStorage.setItem('instanceId', instanceId);
    }

    if (!instanceId) {
        instanceId =
            Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15) +
            Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('displayInitialMessage', 'true');
        sessionStorage.setItem('instanceId', instanceId);
    }

    return instanceId;
};

axiosInstance.interceptors.request.use(
    (config) => {
        const instanceId = getOrCreateInstanceId();

        if (instanceId) {
            // Add the instanceId to the query params
            config.params = {
                ...config.params,
                instanceId,
            };
        }

        return config;
    },
    (error) => {
        return Promise.reject(error);
    },
);

interface RetryConfig extends AxiosRequestConfig {
    retryCount?: number;
}

const MAX_RETRIES = 3;

// Response interceptor to validate data integrity and auto-retry for large JSON responses
axiosInstance.interceptors.response.use(
    async (response) => {
        const isOperationsEndpoint = response.config.url?.endsWith(ENDPOINTS.operationsList);

        if (response.config.method === 'get' && isOperationsEndpoint && !Array.isArray(response.data)) {
            const retryCount = (response.config as RetryConfig).retryCount || 0;

            if (retryCount < MAX_RETRIES) {
                const backoffDelay = Math.min(500 * 2 ** retryCount, 2500);

                // eslint-disable-next-line no-console
                console.warn(
                    `Endpoint returned invalid format (${typeof response.data}). ` +
                        `Auto-retrying (attempt ${retryCount + 1}/${MAX_RETRIES}) after ${backoffDelay}ms...`,
                );

                await new Promise((resolve) => {
                    setTimeout(resolve, backoffDelay);
                });

                const newConfig = {
                    ...response.config,
                    retryCount: retryCount + 1,
                };

                return axiosInstance.request(newConfig);
            }

            const error: AxiosError = new AxiosError(
                `Invalid response format from ${response.config.url} after ${MAX_RETRIES} retries: ` +
                    `expected array, got ${typeof response.data}. This may indicate a server-side issue with large datasets.`,
            );
            error.config = response.config;
            error.response = response;

            return Promise.reject(error);
        }

        return response;
    },
    (error) => {
        return Promise.reject(error);
    },
);

export default axiosInstance;
