// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';

// Create an Axios instance
const axiosInstance = axios.create({
    baseURL: '/', // Your API base URL
});

export const getOrCreateInstanceId = () => {
    let instanceId = sessionStorage.getItem('instanceId');
    const urlInstanceId = new URLSearchParams(window.location.search).get('instanceId');
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

export default axiosInstance;
