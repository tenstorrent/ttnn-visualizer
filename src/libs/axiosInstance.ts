// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';

// Create an Axios instance
const axiosInstance = axios.create({
    baseURL: '/', // Your API base URL
});

const getOrCreateTabId = () => {
    let tabId = sessionStorage.getItem('tab_id');
    if (!tabId) {
        tabId = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('tab_id', tabId);
    }
    return tabId;
};

axiosInstance.interceptors.request.use(
    (config) => {
        const tabId = getOrCreateTabId();
        if (tabId) {
            // Add the tabId to the query params
            config.params = {
                ...config.params,
                tabId,
            };
        }
        return config;
    },
    (error) => {
        return Promise.reject(error);
    },
);

export default axiosInstance;
