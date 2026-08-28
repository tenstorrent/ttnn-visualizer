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

// No stack trace, so `SourceFileButton` never mounts and the panel stays a pure
// render — as in OpGraphPanelPerfMetric.spec.tsx.
const operation = (id: number, name: string): OperationDescription =>
    ({
        id,
        name,
        operationFileIdentifier: 'ttnn_sentencebert_self_attention.py:31',
        inputs: [],
        outputs: [],
        arguments: [],
        deviceOperationNameList: [],
        stack_trace: '',
        stack_trace_source_file_id: null,
    }) as unknown as OperationDescription;

const renderPanel = (block?: OpGraphBlockSummary) => {
    const ops = (block?.operationIds ?? [187]).map((id) =>
        operation(id, 'ttnn.experimental.split_query_key_value_and_split_heads'),
    );
    return render(
        <MemoryRouter>
            <OpGraphInfoPanel
                operationId={ops[0].id}
                operationById={new Map(ops.map((op) => [op.id, op]))}
                operationNamesById={new Map(ops.map((op) => [op.id, op.name]))}
                onLocateOperation={vi.fn()}
                isPerfOverlayActive={false}
                block={block}
            />
        </MemoryRouter>,
    );
};

afterEach(cleanup);

// Both headings are `text-overflow: ellipsis`, and the label is the one thing the
// panel exists to show — without a tooltip a four-module block name is readable
// nowhere in the app, on the node or in the panel. #1944
describe('op graph panel heading tooltips', () => {
    it('carries the whole block label as a tooltip', () => {
        const label = 'self_attention + self_output + intermediate + output';
        renderPanel({
            instanceId: 'block:0:187',
            operationIds: [187, 188],
            label,
            patternLabel: label,
            instanceIndex: 1,
            instanceCount: 11,
            durationSeconds: 0,
            memoryDeltaBytes: 0,
        });

        expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute('title', label);
    });

    it('carries the whole operation label as a tooltip', () => {
        renderPanel();

        expect(screen.getByRole('heading', { level: 2 })).toHaveAttribute(
            'title',
            '187 ttnn.experimental.split_query_key_value_and_split_heads',
        );
    });
});
