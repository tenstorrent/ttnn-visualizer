// axiosInstance.js
import axios from 'axios';

// Create an Axios instance
const axiosInstance = axios.create({
    baseURL: '/',  // Your API base URL
});

const getOrCreateTabId = () => {
    let tabId = sessionStorage.getItem('tab_id');
    if (!tabId) {
        tabId = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('tab_id', tabId);
    }
    return tabId;
};

// Add a request interceptor to include tab ID
axiosInstance.interceptors.request.use(
    (config) => {
        // Get the tab ID from sessionStorage
        const tabId = getOrCreateTabId()

        // Attach the tab ID to the request headers
        if (tabId) {
            config.headers['Tab-ID'] = tabId;
        }

        return config;
    },
    (error) => {
        // Handle request errors here
        return Promise.reject(error);
    }
);

export default axiosInstance;
