// axiosInstance.js
import axios from 'axios';

// Create an Axios instance
const axiosInstance = axios.create({
    baseURL: '',  // Your API base URL
});

const getOrCreateTabId = () => {
    let tabId = sessionStorage.getItem('tab_id');
    if (!tabId) {
        tabId = Math.random().toString(36).substring(2, 15);
        sessionStorage.setItem('tab_id', tabId);
    }
    return tabId;
};

axiosInstance.interceptors.request.use((config) => {
    const tabId = getOrCreateTabId()
    if (tabId) {
        config.params = {
            ...config.params,
            tabId
        };
    }
    return config;
});



export default axiosInstance;
