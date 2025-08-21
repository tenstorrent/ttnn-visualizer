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
}

const getServerConfig = (): ServerConfig => {
    // Dev mode configuration
    if (import.meta.env.DEV) {
        return {
            BASE_PATH: '/',
            SERVER_MODE: !!import.meta.env.VITE_SERVER_MODE || false,
            TT_METAL_HOME: import.meta.env.VITE_TT_METAL_HOME || undefined,
        };
    }

    return {
        BASE_PATH: window?.TTNN_VISUALIZER_CONFIG?.BASE_PATH || '/',
        SERVER_MODE: window?.TTNN_VISUALIZER_CONFIG?.SERVER_MODE || false,
        TT_METAL_HOME: window?.TTNN_VISUALIZER_CONFIG?.TT_METAL_HOME || undefined,
    };
};

export default getServerConfig;
