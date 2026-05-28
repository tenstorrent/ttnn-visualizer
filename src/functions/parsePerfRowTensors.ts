// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PerfTableRow } from '../definitions/PerfTable';
import { DeviceOperationLayoutTypes } from '../model/APIData';
import { BufferType } from '../model/BufferType';

const DEV_MEMORY_REGEX = /DEV_(\d+)_(DRAM|L1)_(\w*)/m;

export interface BasicTensor {
    label: string;
    dtype: string;
    memory: string;
    buffer_type: BufferType | null;
    layout: DeviceOperationLayoutTypes | null;
}

export interface ParsedPerfRowTensors {
    inputs: BasicTensor[];
    outputs: BasicTensor[];
    buffer_type: BufferType | null;
    layout: DeviceOperationLayoutTypes | null;
}

const getBufferType = (type?: string): BufferType | null => {
    if (!type) {
        return null;
    }

    if (type === 'L1') {
        return BufferType.L1;
    }

    if (type === 'DRAM') {
        return BufferType.DRAM;
    }

    return null;
};

const parseMemoryString = (memory: string): Pick<BasicTensor, 'buffer_type' | 'layout'> => {
    const match = DEV_MEMORY_REGEX.exec(memory);

    return {
        buffer_type: getBufferType(match?.[2]),
        layout: match?.[3] ? (match[3] as DeviceOperationLayoutTypes) : null,
    };
};

const hasBasicTensorData = (dtype: string, memory: string): boolean => dtype.length > 0 || memory.length > 0;

export const parsePerfRowTensors = (
    row: Pick<
        PerfTableRow,
        | 'input_0_datatype'
        | 'input_1_datatype'
        | 'output_datatype'
        | 'input_0_memory'
        | 'input_1_memory'
        | 'output_0_memory'
    >,
): ParsedPerfRowTensors => {
    const inputs: BasicTensor[] = [];
    const outputs: BasicTensor[] = [];

    if (hasBasicTensorData(row.input_0_datatype, row.input_0_memory)) {
        inputs.push({
            label: 'Input 0',
            dtype: row.input_0_datatype,
            memory: row.input_0_memory,
            ...parseMemoryString(row.input_0_memory),
        });
    }

    if (hasBasicTensorData(row.input_1_datatype, row.input_1_memory)) {
        inputs.push({
            label: 'Input 1',
            dtype: row.input_1_datatype,
            memory: row.input_1_memory,
            ...parseMemoryString(row.input_1_memory),
        });
    }

    if (hasBasicTensorData(row.output_datatype, row.output_0_memory)) {
        outputs.push({
            label: 'Output',
            dtype: row.output_datatype,
            memory: row.output_0_memory,
            ...parseMemoryString(row.output_0_memory),
        });
    }

    const primaryAttributes = parseMemoryString(row.input_0_memory);

    return {
        inputs,
        outputs,
        buffer_type: primaryAttributes.buffer_type,
        layout: primaryAttributes.layout,
    };
};
