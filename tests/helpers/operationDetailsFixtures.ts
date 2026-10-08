// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { BufferData, type Node, type OperationDetailsData } from '../../src/model/APIData';
import { BufferType } from '../../src/model/BufferType';
import { TensorDeallocationReport } from '../../src/model/BufferSummary';
import { OperationDetails } from '../../src/model/OperationDetails';

/**
 * Shared builders for `OperationDetails`, so specs don't each hand-roll the
 * minimal API shape the model needs. The L1 plot harness is in `renderL1Plots`.
 */
export const FIXTURE_L1_SIZE = 1_500_000;

export const buildOperationDetailsData = (overrides: Partial<OperationDetailsData> = {}): OperationDetailsData =>
    ({
        id: 1,
        name: 'op',
        inputs: [],
        outputs: [],
        stack_trace: '',
        stack_trace_source_file_id: null,
        operationFileIdentifier: 'op',
        error: null,
        buffers: [],
        buffersSummary: [],
        l1_sizes: [FIXTURE_L1_SIZE],
        device_operations: [],
        ...overrides,
    }) as unknown as OperationDetailsData;

interface BuildOperationDetailsOptions {
    data?: Partial<OperationDetailsData>;
    deallocationReport?: TensorDeallocationReport[];
}

export const buildOperationDetails = ({
    data,
    deallocationReport = [],
}: BuildOperationDetailsOptions = {}): OperationDetails =>
    new OperationDetails(buildOperationDetailsData(data), [], deallocationReport, {
        l1start: 0,
        l1end: FIXTURE_L1_SIZE,
    });

export const buildBufferData = (overrides: Partial<BufferData> = {}): BufferData => ({
    operation_id: 1,
    device_id: 0,
    address: 0,
    max_size_per_bank: 1024,
    buffer_type: BufferType.L1,
    ...overrides,
});

/**
 * Returns a node builder with its own id counter, so a spec gets ids unique
 * within the graph it builds without sharing or resetting a module counter.
 */
export const createNodeFactory = () => {
    let nextId = 0;

    return <T extends Partial<Node>>(node: T): Node => {
        nextId += 1;
        return { id: nextId, connections: [], inputs: [], outputs: [], stacking_level: 0, ...node } as Node;
    };
};
