// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum PerfTabIds {
    TABLE = 'performance-table-tab',
    CHARTS = 'performance-charts-tab',
}

// Taken from - https://github.com/tenstorrent/tt-metal/blob/main/ttnn/api/tools/profiler/op_profiler.hpp#L33
export enum OpType {
    DEVICE_OP = 'tt_dnn_device', // OP implemented in C++ and running on DEVICE
    PYTHON_OP = 'python_fallback', //  OP fully implemented in python and running on CPU
    CPU_OP = 'tt_dnn_cpu', // OP implemented in C++ and running on CPU
    SIGNPOST = 'signpost',
    UNKNOWN = 'unknown',
}

// The `type` column of `profile_log_device.csv`. Read by name from the capture's
// own header, so the values are tt-metal's, not ours.
export enum DeviceLogEntryType {
    ZONE_START = 'ZONE_START',
    ZONE_END = 'ZONE_END',
    TS_DATA = 'TS_DATA',
}

// What `type` was called before tt-metal renamed it, in captures old enough to
// predate the rename. Not the same vocabulary: the 2024 captures spell the two
// zone boundaries `begin`/`end`, and have no `TS_DATA` counterpart at all.
export enum DeviceLogZonePhase {
    BEGIN = 'begin',
    END = 'end',
}

export const PATTERN_COUNT = 3; // Number of row patterns defined in PerfReport.scss

export const HIGH_DISPATCH_THRESHOLD_US = 6.5; // Threshold for flagging high dispatch latency ops
