// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DEFAULT_SSH_PORT } from '../definitions/RemoteConnection';

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
    REPORT_LINKING_ENABLED?: boolean;
    USERNAME?: string;
    SSH_DEFAULT_PORT?: number;
}

const getValidSshDefaultPort = (value: unknown): number => {
    const parsedPort = Number(value);

    if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort < 65536) {
        return parsedPort;
    }

    return DEFAULT_SSH_PORT;
};

const getServerConfig = (): ServerConfig => {
    // Dev mode configuration - use environment variables to simulate the server config
    if (import.meta.env.DEV) {
        return {
            BASE_PATH: '/',
            SERVER_MODE: !!import.meta.env.VITE_SERVER_MODE || false,
            TT_METAL_HOME: import.meta.env.VITE_TT_METAL_HOME,
            REPORT_DATA_DIRECTORY: import.meta.env.VITE_REPORT_DATA_DIRECTORY || '/path/to/data/directory', // Default value for development
            REPORT_LINKING_ENABLED: true,
            USERNAME: import.meta.env.VITE_USERNAME,
            SSH_DEFAULT_PORT: getValidSshDefaultPort(import.meta.env.VITE_SSH_DEFAULT_PORT),
        };
    }

    return {
        BASE_PATH: window?.TTNN_VISUALIZER_CONFIG?.BASE_PATH || '/',
        SERVER_MODE: window?.TTNN_VISUALIZER_CONFIG?.SERVER_MODE || false,
        TT_METAL_HOME: window?.TTNN_VISUALIZER_CONFIG?.TT_METAL_HOME,
        REPORT_DATA_DIRECTORY: window?.TTNN_VISUALIZER_CONFIG?.REPORT_DATA_DIRECTORY,
        REPORT_LINKING_ENABLED: window?.TTNN_VISUALIZER_CONFIG?.REPORT_LINKING_ENABLED || false,
        USERNAME: window?.TTNN_VISUALIZER_CONFIG?.USERNAME,
        SSH_DEFAULT_PORT: getValidSshDefaultPort(window?.TTNN_VISUALIZER_CONFIG?.SSH_DEFAULT_PORT),
    };
};

export default getServerConfig;
