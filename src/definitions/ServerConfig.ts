// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface ServerConfig {
    SERVER_MODE?: boolean;
    BASE_PATH?: string;
    TT_METAL_HOME?: string;
    REPORT_DATA_DIRECTORY?: string;
    USERNAME?: string;
    SSH_DEFAULT_PORT: number;
    SSH_DEFAULT_PROFILER_PATH: string;
    SSH_DEFAULT_PERFORMANCE_PATH: string;
}
