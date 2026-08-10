// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DEFAULT_SSH_PORT } from '../definitions/RemoteConnection';
import { ServerConfig } from '../definitions/ServerConfig';
import { MAX_PORT } from '../definitions/SshConnectionFields';

declare global {
    interface Window {
        TTNN_VISUALIZER_CONFIG?: Partial<ServerConfig>;
    }
}

const MIN_SSH_PORT = 1;

export function getValidSshDefaultPort(value: unknown): number {
    const parsedPort = Number(value);

    if (Number.isInteger(parsedPort) && parsedPort >= MIN_SSH_PORT && parsedPort <= MAX_PORT) {
        return parsedPort;
    }

    return DEFAULT_SSH_PORT;
}

export function getOptionalPathDefault(value: unknown): string {
    if (typeof value !== 'string') {
        return '';
    }

    return value.trim();
}

function getSshDefaults(port: unknown, profilerPath: unknown, performancePath: unknown) {
    return {
        SSH_DEFAULT_PORT: getValidSshDefaultPort(port),
        SSH_DEFAULT_PROFILER_PATH: getOptionalPathDefault(profilerPath),
        SSH_DEFAULT_PERFORMANCE_PATH: getOptionalPathDefault(performancePath),
    };
}

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
            ...getSshDefaults(
                import.meta.env.VITE_SSH_DEFAULT_PORT,
                import.meta.env.VITE_SSH_DEFAULT_PROFILER_PATH,
                import.meta.env.VITE_SSH_DEFAULT_PERFORMANCE_PATH,
            ),
        };
    }

    const windowConfig = window?.TTNN_VISUALIZER_CONFIG;

    return {
        BASE_PATH: windowConfig?.BASE_PATH || '/',
        SERVER_MODE: windowConfig?.SERVER_MODE || false,
        TT_METAL_HOME: windowConfig?.TT_METAL_HOME,
        REPORT_DATA_DIRECTORY: windowConfig?.REPORT_DATA_DIRECTORY,
        REPORT_LINKING_ENABLED: windowConfig?.REPORT_LINKING_ENABLED || false,
        USERNAME: windowConfig?.USERNAME,
        ...getSshDefaults(
            windowConfig?.SSH_DEFAULT_PORT,
            windowConfig?.SSH_DEFAULT_PROFILER_PATH,
            windowConfig?.SSH_DEFAULT_PERFORMANCE_PATH,
        ),
    };
};

export default getServerConfig;
