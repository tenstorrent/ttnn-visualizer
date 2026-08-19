// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface ServerConfig {
    SERVER_MODE?: boolean;
    BASE_PATH?: string;
    TT_METAL_HOME?: string;
    REPORT_DATA_DIRECTORY?: string;
    USERNAME?: string;
    // Named for the state, matching DefaultConfig.USAGE_RECORDING_ACTIVE. Not
    // USAGE_RECORDING_ENABLED: that spelling is a retired env var the backend no
    // longer reads, and reusing it here would invite someone to set it.
    USAGE_RECORDING_ACTIVE?: boolean;
    SSH_DEFAULT_PORT: number;
    SSH_DEFAULT_PROFILER_PATH: string;
    SSH_DEFAULT_PERFORMANCE_PATH: string;
}
