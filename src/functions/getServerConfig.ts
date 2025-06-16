// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

declare global {
    interface Window {
        TTNN_VISUALIZER_CONFIG?: ServerConfig;
    }
}

interface ServerConfig {
    SERVER_MODE?: boolean;
    BASE_URL?: string;
}

const getServerConfig = (): ServerConfig => {
    return (
        window?.TTNN_VISUALIZER_CONFIG || {
            BASE_URL: '/',
            SERVER_MODE: false,
        }
    );
};

export default getServerConfig;
