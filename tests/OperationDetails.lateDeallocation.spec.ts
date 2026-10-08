// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { OperationDetails } from '../src/model/OperationDetails';
import { BufferData } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import { TensorDeallocationReport } from '../src/model/BufferSummary';
import { buildTensorDeallocationReport } from './helpers/lateDeallocationFixtures';
import { buildBufferData, buildOperationDetails as buildDetails } from './helpers/operationDetailsFixtures';

const SHARED_ADDRESS = 0x4000;

const buffer = (address: number, bufferType: BufferType): BufferData =>
    buildBufferData({ address, buffer_type: bufferType });

const buildOperationDetails = (
    buffersSummary: BufferData[],
    deallocationReport: TensorDeallocationReport[],
): OperationDetails => buildDetails({ data: { buffersSummary }, deallocationReport });

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
