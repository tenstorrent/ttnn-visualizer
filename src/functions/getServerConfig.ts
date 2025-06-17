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
}

const getServerConfig = (): ServerConfig => {
    return (
        window?.TTNN_VISUALIZER_CONFIG || {
            BASE_PATH: '/',
            SERVER_MODE: false,
        }
    );
};

export default getServerConfig;
