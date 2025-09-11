// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

declare global {
    interface Window {
        TTNN_VISUALIZER_CONFIG?: ServerConfig;
    }
}

interface ServerConfig {
    SERVER_MODE?: boolean;
    BASE_PATH?: string;
    TT_METAL_HOME?: string;
    REPORT_DATA_DIRECTORY?: string;
}

const getServerConfig = (): ServerConfig => {
    // Dev mode configuration - use environment variables to simulate the server config
    if (import.meta.env.DEV) {
        return {
            BASE_PATH: '/',
            SERVER_MODE: !!import.meta.env.VITE_SERVER_MODE || false,
            TT_METAL_HOME: import.meta.env.VITE_TT_METAL_HOME,
            REPORT_DATA_DIRECTORY: import.meta.env.VITE_REPORT_DATA_DIRECTORY || '/data',
        };
    }

    return {
        BASE_PATH: window?.TTNN_VISUALIZER_CONFIG?.BASE_PATH || '/',
        SERVER_MODE: window?.TTNN_VISUALIZER_CONFIG?.SERVER_MODE || false,
        TT_METAL_HOME: window?.TTNN_VISUALIZER_CONFIG?.TT_METAL_HOME,
        REPORT_DATA_DIRECTORY: window?.TTNN_VISUALIZER_CONFIG?.REPORT_DATA_DIRECTORY,
    };
};

export default getServerConfig;
