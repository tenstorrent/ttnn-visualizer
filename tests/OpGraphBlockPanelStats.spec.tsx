// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import OpGraphInfoPanel from '../src/components/operation-graph/OpGraphInfoPanel';
import type { OpGraphBlockSummary } from '../src/components/operation-graph/opGraphTypes';
import type { OperationDescription } from '../src/model/APIData';

const operation = (id: number): OperationDescription =>
    ({
        id,
        name: 'ttnn.matmul',
        operationFileIdentifier: 'layer.py:1',
        inputs: [],
        outputs: [],
        arguments: [],
        deviceOperationNameList: [],
        stack_trace: '',
        stack_trace_source_file_id: null,
    }) as unknown as OperationDescription;

const block = (durationSeconds: number, memoryDeltaBytes: number): OpGraphBlockSummary => ({
    instanceId: 'block:0:2',
    operationIds: [2, 3],
    label: 'layer_a + layer_b',
    patternLabel: 'layer_a + layer_b',
    instanceIndex: 0,
    instanceCount: 4,
    durationSeconds,
    memoryDeltaBytes,
});

const renderBlockPanel = (summary: OpGraphBlockSummary) => {
    const ops = summary.operationIds.map(operation);
    return render(
        <MemoryRouter>
            <OpGraphInfoPanel
                operationId={ops[0].id}
                operationById={new Map(ops.map((op) => [op.id, op]))}
                operationNamesById={new Map(ops.map((op) => [op.id, op.name]))}
                onLocateOperation={vi.fn()}
                isPerfOverlayActive={false}
                block={summary}
            />
        </MemoryRouter>,
    );
};

afterEach(cleanup);

// Both gates and the sign branch were uncovered, and these numbers are also
// formatted onto the block node, which is on screen at the same time. #1944
describe('block panel stats', () => {
    it('shows the operation count unconditionally', () => {
        renderBlockPanel(block(0, 0));

        expect(screen.getByText('Operations')).toBeInTheDocument();
        expect(screen.getByText('2')).toBeInTheDocument();
    });

    it('omits duration and memory rows when there is nothing to report', () => {
        renderBlockPanel(block(0, 0));

        expect(screen.queryByText('Python duration')).not.toBeInTheDocument();
        expect(screen.queryByText('Memory delta')).not.toBeInTheDocument();
    });

    it('shows a duration once there is one', () => {
        renderBlockPanel(block(2, 0));

        expect(screen.getByText('Python duration')).toBeInTheDocument();
        expect(screen.getByText('2 s')).toBeInTheDocument();
    });

    it('signs a positive memory delta', () => {
        renderBlockPanel(block(0, 2048));

        expect(screen.getByText(/^\+2 KiB$/)).toBeInTheDocument();
    });

    it('signs a negative memory delta', () => {
        // The absolute value is formatted and the sign prepended, so a bare
        // formatMemorySize of a negative number would read wrong here.
        renderBlockPanel(block(0, -2048));

        expect(screen.getByText(/^-2 KiB$/)).toBeInTheDocument();
    });
});
