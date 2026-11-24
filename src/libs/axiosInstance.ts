// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios, { AxiosError, AxiosRequestConfig, isAxiosError } from 'axios';
import getServerConfig from '../functions/getServerConfig';
import Endpoints from '../definitions/Endpoints';

const serverConfig = getServerConfig();
const baseURL = serverConfig?.BASE_PATH;

const axiosInstance = axios.create({
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
    baseURL,
});

// Resolved once per page load rather than per call. The id is fixed for the
// lifetime of the tab — it is read from the URL or sessionStorage and written
// straight back — but it is read inside query keys, and those are rebuilt in the
// render body of hooks reached once per virtualised row (`useLinkedPerformanceReport`
// through `OperationListPerfData`). Uncached, that is a synchronous sessionStorage
// read plus a `URLSearchParams` allocation per row, per scroll tick.
let cachedInstanceId: string | null = null;

const resolveInstanceId = () => {
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

export const getOrCreateInstanceId = () => {
    cachedInstanceId ??= resolveInstanceId();

    return cachedInstanceId;
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

// `decorators.INSTANCE_NOT_OWNED`: the two must change together.
const INSTANCE_NOT_OWNED = 'instance_not_owned';
const FRESH_INSTANCE_AT_KEY = 'freshInstanceAt';
const FRESH_INSTANCE_COOLDOWN_MS = 60_000;

/**
 * Starts the tab afresh when a hosted server refuses its instance as another session's, as it does
 * once the session cookie that created it is lost. Every request would fail the same way, so the ID
 * is dropped and the tab reloads onto a new one. At most once a minute, so a browser that never keeps
 * the cookie can't reload forever.
 * @returns whether the tab is reloading.
 */
export const startOnFreshInstance = (
    error: unknown,
    reload: (url: URL) => void = (url) => window.location.replace(url),
    now: number = Date.now(),
): boolean => {
    if (!isAxiosError(error) || error.response?.status !== 403 || error.response.data?.reason !== INSTANCE_NOT_OWNED) {
        return false;
    }

    const lastFreshInstanceAt = Number(sessionStorage.getItem(FRESH_INSTANCE_AT_KEY));

    if (lastFreshInstanceAt && now - lastFreshInstanceAt < FRESH_INSTANCE_COOLDOWN_MS) {
        return false;
    }

    sessionStorage.setItem(FRESH_INSTANCE_AT_KEY, String(now));
    sessionStorage.removeItem('instanceId');

    const url = new URL(window.location.href);
    url.searchParams.delete('instanceId');
    reload(url);

    return true;
};

interface RetryConfig extends AxiosRequestConfig {
    retryCount?: number;
}

const MAX_RETRIES = 3;

// Response interceptor to validate data integrity and auto-retry for large JSON responses
axiosInstance.interceptors.response.use(
    async (response) => {
        const isOperationsEndpoint = response.config.url?.endsWith(Endpoints.OPERATIONS_LIST);

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
        startOnFreshInstance(error);

        return Promise.reject(error);
    },
);

export default axiosInstance;
