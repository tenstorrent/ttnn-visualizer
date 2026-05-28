// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import PerfTensorPanel from '../src/components/performance/PerfTensorPanel';
import { BoundType, TypedPerfTableRow } from '../src/definitions/PerfTable';
import { TEST_IDS } from '../src/definitions/TestIds';
import ROUTES from '../src/definitions/Routes';
import { OperationDescription, Tensor } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { OpType } from '../src/definitions/Performance';
import { TestProviders } from './helpers/TestProviders';

const baseRow: TypedPerfTableRow = {
    id: 42,
    global_call_count: 0,
    advice: [],
    total_percent: 1,
    bound: BoundType.FLOP,
    op_code: 'Matmul',
    raw_op_code: 'Matmul',
    device: 0,
    device_time: 10,
    op_to_op_gap: 0,
    cores: 1,
    dram: 0,
    dram_percent: 0,
    flops: 0,
    flops_percent: 0,
    math_fidelity: 'HiFi4',
    output_datatype: 'DataType::BFLOAT16',
    output_0_memory: 'DEV_0_DRAM_TILE',
    input_0_datatype: 'DataType::BFLOAT16',
    input_1_datatype: '',
    dram_sharded: '',
    input_0_memory: 'DEV_0_L1_TILE',
    input_1_memory: '',
    inner_dim_block_size: '',
    output_subblock_h: '',
    output_subblock_w: '',
    pm_ideal_ns: null,
    op_type: OpType.DEVICE_OP,
    hash: null,
    cache_hit: null,
    buffer_type: BufferType.L1,
    layout: null,
    isFirstHashOccurrence: true,
};

const enrichedTensor: Tensor = {
    id: 100,
    address: 4096,
    buffer_type: BufferType.L1,
    producers: [10],
    consumers: [12],
    producerNames: [],
    consumerNames: [],
    shape: 'Shape([1, 32, 32])',
    dtype: 'DataType::BFLOAT16',
    layout: 'Layout::TILE',
    memory_config: null,
    device_id: 0,
    comparison: null,
    io: 'input',
    size: 2048,
};

const operations: OperationDescription[] = [
    {
        id: 11,
        name: 'matmul_op',
        inputs: [enrichedTensor],
        outputs: [{ ...enrichedTensor, id: 101, io: 'output', producers: [11], consumers: [13] }],
        stack_trace: '',
        stack_trace_source_file_id: null,
        device_operations: [],
        operationFileIdentifier: 'matmul.cpp',
        error: null,
        duration: 1,
        arguments: [],
        processedConnections: [],
        deviceOperationNameList: ['Matmul'],
    },
    {
        id: 10,
        name: 'producer_op',
        inputs: [],
        outputs: [],
        stack_trace: '',
        stack_trace_source_file_id: null,
        device_operations: [],
        operationFileIdentifier: 'producer.cpp',
        error: null,
        duration: 1,
        arguments: [],
        processedConnections: [],
        deviceOperationNameList: [],
    },
    {
        id: 12,
        name: 'consumer_op',
        inputs: [],
        outputs: [],
        stack_trace: '',
        stack_trace_source_file_id: null,
        device_operations: [],
        operationFileIdentifier: 'consumer.cpp',
        error: null,
        duration: 1,
        arguments: [],
        processedConnections: [],
        deviceOperationNameList: [],
    },
];

function renderPanel(
    row: TypedPerfTableRow,
    operation: OperationDescription | null,
    ops: OperationDescription[] = operations,
) {
    return render(
        <TestProviders>
            <PerfTensorPanel
                row={row}
                operation={operation}
                operations={ops}
            />
        </TestProviders>,
    );
}

afterEach(cleanup);

describe('PerfTensorPanel', () => {
    it('shows basic tensor info and CTA when not enriched', () => {
        renderPanel(baseRow, null);

        expect(screen.getByTestId(TEST_IDS.PERF_TENSOR_DRAWER_CTA)).toBeInTheDocument();
        expect(screen.getByText('Input 0')).toBeInTheDocument();
        expect(screen.getByText('DEV_0_L1_TILE')).toBeInTheDocument();
        expect(screen.getByText('DEV_0_DRAM_TILE')).toBeInTheDocument();
        expect(screen.queryByText('Tensor Id')).not.toBeInTheDocument();
    });

    it('shows enriched tensor fields and hides CTA when operation is matched', () => {
        renderPanel({ ...baseRow, op: 11 }, operations[0]);

        expect(screen.queryByTestId(TEST_IDS.PERF_TENSOR_DRAWER_CTA)).not.toBeInTheDocument();
        expect(screen.getAllByText('Tensor Id')).toHaveLength(2);
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('101')).toBeInTheDocument();
        expect(screen.getAllByText('[1, 32, 32]')).toHaveLength(2);
        expect(screen.getAllByText('2 KiB')).toHaveLength(2);
    });

    it('links producer and consumer operations to operation details', () => {
        renderPanel({ ...baseRow, op: 11 }, operations[0]);

        expect(screen.getByRole('link', { name: /10 producer_op/i })).toHaveAttribute(
            'href',
            `${ROUTES.OPERATIONS}/10`,
        );
        expect(screen.getByRole('link', { name: /12 consumer_op/i })).toHaveAttribute(
            'href',
            `${ROUTES.OPERATIONS}/12`,
        );
    });
});
