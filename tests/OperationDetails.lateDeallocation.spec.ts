// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { OperationDetails } from '../src/model/OperationDetails';
import { BufferData, OperationDetailsData } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { TensorDeallocationReport } from '../src/model/BufferSummary';
import { buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';

const SHARED_ADDRESS = 0x4000;

const buffer = (address: number, bufferType: BufferType): BufferData => ({
    operation_id: 1,
    device_id: 0,
    address,
    max_size_per_bank: 256,
    buffer_type: bufferType,
});

const buildOperationDetails = (
    buffersSummary: BufferData[],
    deallocationReport: TensorDeallocationReport[],
): OperationDetails => {
    const data = {
        id: 1,
        name: 'op',
        inputs: [],
        outputs: [],
        stack_trace: '',
        stack_trace_source_file_id: null,
        operationFileIdentifier: 'op',
        error: null,
        buffers: [],
        buffersSummary,
        l1_sizes: [1_000_000],
        device_operations: [],
    } as unknown as OperationDetailsData;

    return new OperationDetails(data, [], deallocationReport, { l1start: 0, l1end: 1_000_000 });
};

const lateDeallocationFlagAt = (details: OperationDetails, bufferType: BufferType, address: number) =>
    details.memoryData(bufferType).memory.find((chunk) => chunk.address === address)?.lateDeallocation;

describe('OperationDetails late deallocation (#1862)', () => {
    it('flags an L1 buffer at a reported address', () => {
        const details = buildOperationDetails(
            [buffer(SHARED_ADDRESS, BufferType.L1)],
            [buildTensorDeallocationReport({ address: SHARED_ADDRESS })],
        );

        expect(lateDeallocationFlagAt(details, BufferType.L1, SHARED_ADDRESS)).toBe(true);
    });

    // The report is derived from L1 buffers only, so an address match in
    // another memory space is a coincidence, not a finding.
    it.each([
        ['DRAM', BufferType.DRAM],
        ['L1 Small', BufferType.L1_SMALL],
    ])('does not flag a %s buffer that shares a late L1 address', (_label, bufferType) => {
        const details = buildOperationDetails(
            [buffer(SHARED_ADDRESS, BufferType.L1), buffer(SHARED_ADDRESS, bufferType)],
            [buildTensorDeallocationReport({ address: SHARED_ADDRESS })],
        );

        expect(lateDeallocationFlagAt(details, bufferType, SHARED_ADDRESS)).toBe(false);
    });

    it('returns the report for an address, or null when none is reported', () => {
        const report = buildTensorDeallocationReport({ address: SHARED_ADDRESS });
        const details = buildOperationDetails([buffer(SHARED_ADDRESS, BufferType.L1)], [report]);

        expect(details.getLateDeallocationForAddress(SHARED_ADDRESS)).toEqual(report);
        expect(details.getLateDeallocationForAddress(SHARED_ADDRESS + 1)).toBeNull();
    });

    it('counts each late tensor once', () => {
        const details = buildOperationDetails(
            [],
            [
                buildTensorDeallocationReport({ id: 1, address: 0x1000 }),
                buildTensorDeallocationReport({ id: 1, address: 0x2000 }),
                buildTensorDeallocationReport({ id: 2, address: 0x3000 }),
            ],
        );

        expect(details.lateDeallocationCount).toBe(2);
    });

    it('counts zero when nothing is reported', () => {
        expect(buildOperationDetails([], []).lateDeallocationCount).toBe(0);
    });
});
