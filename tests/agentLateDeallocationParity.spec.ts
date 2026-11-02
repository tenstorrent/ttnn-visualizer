// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    buildLateDeallocationReports,
    buildTensorsByOperationByAddress,
    getUniqueBuffersByOperation,
    selectLateDeallocationRunStarts,
} from '../src/functions/lateDeallocation';
import { Buffer, BuffersByOperation, Operation, Tensor } from '../src/model/APIData';
import { BufferType } from '../src/model/BufferType';
import golden from './data/agentLateDeallocationParity.json';

// The agent's Python port (#2156) wrote this golden, from test_agent_late_deallocation_parity.py;
// holding the app to it fails a change on either side. Regenerate with `pnpm run agent:parity-golden`.

type ParityTensor = Pick<Tensor, 'id' | 'address' | 'consumers'>;

interface ParityCase {
    operations: { id: number; name: string | null; inputs: ParityTensor[]; outputs: ParityTensor[] }[];
    buffersByOperation: {
        id: number;
        buffers: { device_id: number; address: number | null; size: number | null }[];
    }[];
    expected: {
        held: [number, { tensor_id: number; address: number; last_use_operation_id: number; size: number }[]][];
        run_start_count: number;
    };
}

const indexedCases = <T>(cases: T[]) => cases.map((entry, index) => [index, entry] as const);

it('the golden holds cases', () => {
    expect(golden.cases.length).toBeGreaterThan(0);
});

describe('Buffer Summary late deallocations', () => {
    it.each(indexedCases(golden.cases as ParityCase[]))(
        'case %i matches the agent',
        (_, { operations, buffersByOperation, expected }) => {
            const uniqueBuffersByOperation = getUniqueBuffersByOperation(
                buffersByOperation.map(
                    ({ id, buffers }): BuffersByOperation => ({
                        id,
                        name: '',
                        buffers: buffers.map((buffer) => ({ ...buffer, buffer_type: BufferType.L1 }) as Buffer),
                    }),
                ),
            );
            const { reportsByOpId } = buildLateDeallocationReports({
                tensorsByOperation: buildTensorsByOperationByAddress(
                    operations as unknown as Pick<Operation, 'id' | 'inputs' | 'outputs'>[],
                    uniqueBuffersByOperation,
                ),
                operationNamesById: new Map(operations.map(({ id, name }) => [id, name as string])),
            });
            const sizeAt = (operationId: number, address: number) =>
                uniqueBuffersByOperation
                    .find(({ id }) => id === operationId)
                    ?.buffers.find((buffer) => buffer.address === address)?.size;

            expect(
                [...reportsByOpId.entries()].map(([operationId, reports]) => [
                    operationId,
                    reports.map(({ id, address, lastConsumerOperationId }) => ({
                        tensor_id: id,
                        address,
                        last_use_operation_id: lastConsumerOperationId,
                        // The app compares a null size as 0, which the agent reads it as.
                        size: sizeAt(operationId, address) ?? 0,
                    })),
                ]),
            ).toEqual(expected.held);
            // The rows Buffer Summary renders are the unique buffers' operations.
            expect(
                selectLateDeallocationRunStarts({ operations: uniqueBuffersByOperation, reportsByOpId }).length,
            ).toBe(expected.run_start_count);
        },
    );
});
