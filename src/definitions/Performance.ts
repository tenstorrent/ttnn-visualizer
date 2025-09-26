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
