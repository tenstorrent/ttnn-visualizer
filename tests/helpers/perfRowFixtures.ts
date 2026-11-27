// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow, TypedPerfTableRow } from '../../src/model/PerfTable';
import { OpType } from '../../src/definitions/Performance';

// A raw row as delivered to the frontend: the numeric columns arrive as strings (matching the
// CSV-derived JSON), alongside non-string fields like global_call_count, advice, and hash.
export const makeRawPerfRow = (overrides: Partial<PerfTableRow> = {}): PerfTableRow =>
    ({
        id: '1',
        global_call_count: 0,
        advice: [],
        total_percent: '12.5',
        bound: 'DRAM',
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        device: '0',
        device_time: '123.4',
        op_to_op_gap: '2.5',
        cores: '64',
        dram: '15.5',
        dram_percent: '42.1',
        flops: '88.8',
        flops_percent: '73.2',
        math_fidelity: 'HiFi4',
        output_datatype: 'BFLOAT16',
        output_0_memory: '',
        input_0_datatype: 'BFLOAT16',
        input_1_datatype: 'BFLOAT16',
        dram_sharded: '',
        input_0_memory: 'DEV_0_DRAM_INTERLEAVED',
        input_1_memory: '',
        inner_dim_block_size: '',
        output_subblock_h: '',
        output_subblock_w: '',
        pm_ideal_ns: '1000',
        op_type: OpType.DEVICE_OP,
        hash: null,
        cache_hit: null,
        ...overrides,
    }) as PerfTableRow;

// bge_m3's untraced ttnn.cumsum: no matmul, so no roofline, and gaps dwarf device time, so Total % rounds to 0.
const BGE_M3_CUMSUM_COLUMNS: Partial<PerfTableRow> = {
    bound: '' as PerfTableRow['bound'],
    bound_analysis: 'none',
    dram: '',
    dram_percent: '',
    flops: '',
    flops_percent: '',
    total_percent: '0.0',
};

export const BGE_M3_CUMSUM = {
    firstPermute: makeRawPerfRow({
        ...BGE_M3_CUMSUM_COLUMNS,
        id: '5',
        raw_op_code: 'PermuteDeviceOperation',
        device_time: '14.418',
        cores: '64',
    }),
    accumulation: makeRawPerfRow({
        ...BGE_M3_CUMSUM_COLUMNS,
        id: '6',
        raw_op_code: 'AccumulationDeviceOperation',
        device_time: '115.73',
        cores: '1',
    }),
    secondPermute: makeRawPerfRow({
        ...BGE_M3_CUMSUM_COLUMNS,
        id: '7',
        raw_op_code: 'PermuteDeviceOperation',
        device_time: '5.559',
        cores: '32',
    }),
};

/** bge_m3's whole device time (µs), which each of its operations' shares divides by. */
export const BGE_M3_DEVICE_TIME_US = 49_989;

// A typed row with only the fields the perf charts read; specs override what they assert on.
export const makeTypedPerfRow = (overrides: Partial<TypedPerfTableRow> = {}): TypedPerfTableRow =>
    ({
        op_type: OpType.DEVICE_OP,
        op_code: 'Matmul',
        raw_op_code: 'Matmul',
        cores: 16,
        device_time: 1_000,
        advice: [],
        bound: null,
        isFirstHashOccurrence: true,
        id: 1,
        ...overrides,
    }) as unknown as TypedPerfTableRow;
