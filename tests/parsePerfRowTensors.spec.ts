// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { BoundType, PerfTableRow } from '../src/definitions/PerfTable';
import { parsePerfRowTensors } from '../src/functions/parsePerfRowTensors';
import { BufferType } from '../src/model/BufferType';
import { DeviceOperationLayoutTypes } from '../src/model/APIData';
import { OpType } from '../src/definitions/Performance';

const baseRow: PerfTableRow = {
    id: '1',
    global_call_count: 0,
    advice: [],
    total_percent: '1.0',
    bound: BoundType.FLOP,
    op_code: 'Matmul',
    raw_op_code: 'Matmul',
    device: '0',
    device_time: '10',
    op_to_op_gap: '0',
    cores: '1',
    dram: '0',
    dram_percent: '0',
    flops: '0',
    flops_percent: '0',
    math_fidelity: 'HiFi4',
    output_datatype: 'DataType::BFLOAT16',
    output_0_memory: 'DEV_0_DRAM_TILE',
    input_0_datatype: 'DataType::BFLOAT16',
    input_1_datatype: 'DataType::BFLOAT16',
    dram_sharded: '',
    input_0_memory: 'DEV_0_L1_TILE',
    input_1_memory: 'DEV_0_DRAM_INTERLEAVED',
    inner_dim_block_size: '',
    output_subblock_h: '',
    output_subblock_w: '',
    pm_ideal_ns: '',
    op_type: OpType.DEVICE_OP,
    hash: null,
    cache_hit: null,
};

describe('parsePerfRowTensors', () => {
    it('parses input and output slots from perf row strings', () => {
        const parsed = parsePerfRowTensors(baseRow);

        expect(parsed.inputs).toHaveLength(2);
        expect(parsed.outputs).toHaveLength(1);
        expect(parsed.inputs[0]).toMatchObject({
            label: 'Input 0',
            dtype: 'DataType::BFLOAT16',
            memory: 'DEV_0_L1_TILE',
            buffer_type: BufferType.L1,
            layout: DeviceOperationLayoutTypes.TILE,
        });
        expect(parsed.outputs[0]).toMatchObject({
            label: 'Output',
            dtype: 'DataType::BFLOAT16',
            memory: 'DEV_0_DRAM_TILE',
            buffer_type: BufferType.DRAM,
            layout: DeviceOperationLayoutTypes.TILE,
        });
    });

    it('derives table row attributes from input_0_memory', () => {
        const parsed = parsePerfRowTensors(baseRow);

        expect(parsed.buffer_type).toBe(BufferType.L1);
        expect(parsed.layout).toBe(DeviceOperationLayoutTypes.TILE);
    });

    it('returns empty sections when tensor strings are missing', () => {
        const parsed = parsePerfRowTensors({
            ...baseRow,
            input_0_datatype: '',
            input_1_datatype: '',
            output_datatype: '',
            input_0_memory: '',
            input_1_memory: '',
            output_0_memory: '',
        });

        expect(parsed.inputs).toHaveLength(0);
        expect(parsed.outputs).toHaveLength(0);
        expect(parsed.buffer_type).toBeNull();
        expect(parsed.layout).toBeNull();
    });

    it('handles single-input ops with only input_0 populated', () => {
        const parsed = parsePerfRowTensors({
            ...baseRow,
            input_1_datatype: '',
            input_1_memory: '',
        });

        expect(parsed.inputs).toHaveLength(1);
        expect(parsed.inputs[0].label).toBe('Input 0');
    });

    it('returns null buffer type for unrecognized memory prefixes', () => {
        const parsed = parsePerfRowTensors({
            ...baseRow,
            input_0_memory: 'UNKNOWN_MEMORY',
        });

        expect(parsed.inputs[0].buffer_type).toBeNull();
        expect(parsed.inputs[0].layout).toBeNull();
    });
});
