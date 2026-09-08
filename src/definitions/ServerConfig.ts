// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export interface ServerConfig {
    SERVER_MODE?: boolean;
    BASE_PATH?: string;
    TT_METAL_HOME?: string;
    REPORT_DATA_DIRECTORY?: string;
    USERNAME?: string;
    // Named for the state, matching DefaultConfig.USAGE_RECORDING_ACTIVE: the backend's
    // own variable is the opposite polarity, so a name borrowed from it would read true
    // when recording is off.
    USAGE_RECORDING_ACTIVE?: boolean;
    SSH_DEFAULT_PORT: number;
    SSH_DEFAULT_PROFILER_PATH: string;
    SSH_DEFAULT_PERFORMANCE_PATH: string;
}
