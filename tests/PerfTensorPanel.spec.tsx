// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import PerfTensorPanel from '../src/components/performance/PerfTensorPanel';
import ROUTES from '../src/definitions/Routes';
import { OperationDescription, Tensor } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { TestProviders } from './helpers/TestProviders';

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

function renderPanel(operation: OperationDescription, ops: OperationDescription[] = operations) {
    return render(
        <TestProviders>
            <PerfTensorPanel
                operation={operation}
                operations={ops}
            />
        </TestProviders>,
    );
}

afterEach(cleanup);

describe('PerfTensorPanel', () => {
    it('renders enriched input and output tensor fields', () => {
        renderPanel(operations[0]);

        expect(screen.getAllByText('Tensor Id')).toHaveLength(2);
        expect(screen.getByText('100')).toBeInTheDocument();
        expect(screen.getByText('101')).toBeInTheDocument();
        expect(screen.getAllByText('[1, 32, 32]')).toHaveLength(2);
        expect(screen.getAllByText('2 KiB')).toHaveLength(2);
    });

    it('links producer and consumer operations to operation details', () => {
        renderPanel(operations[0]);

        expect(screen.getByRole('link', { name: /10 producer_op/i })).toHaveAttribute(
            'href',
            `${ROUTES.OPERATIONS}/10`,
        );
        expect(screen.getByRole('link', { name: /12 consumer_op/i })).toHaveAttribute(
            'href',
            `${ROUTES.OPERATIONS}/12`,
        );
    });

    it('shows an empty state when the operation has no input or output tensors', () => {
        renderPanel({ ...operations[0], inputs: [], outputs: [] });

        expect(screen.getByText('No input tensors')).toBeInTheDocument();
        expect(screen.getByText('No output tensors')).toBeInTheDocument();
    });
});
