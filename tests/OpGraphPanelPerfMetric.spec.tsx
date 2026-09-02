// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

import OpGraphInfoPanel from '../src/components/operation-graph/OpGraphInfoPanel';
import { NO_PERF_DATA_LABEL } from '../src/definitions/PerfOverlayStatus';
import { perfColorScale } from '../src/functions/perfOverlay';
import { formatDuration } from '../src/functions/formatting';
import type { OperationDescription } from '../src/model/APIData';

// No stack trace, so `SourceFileButton` (which probes the backend eagerly)
// never mounts and the panel stays a pure render.
const OPERATION = {
    id: 5,
    name: 'ttnn.matmul',
    operationFileIdentifier: 'ttnn_functional_resnet50.py:280',
    inputs: [],
    outputs: [],
    arguments: [],
    deviceOperationNameList: [],
    stack_trace: '',
    stack_trace_source_file_id: null,
} as unknown as OperationDescription;

interface RenderOptions {
    isPerfOverlayActive: boolean;
    perfDeviceTimeNs?: number;
    perfColor?: string;
}

const renderPanel = ({ isPerfOverlayActive, perfDeviceTimeNs, perfColor }: RenderOptions) =>
    render(
        <MemoryRouter>
            <OpGraphInfoPanel
                operationId={OPERATION.id}
                operationById={new Map<number, OperationDescription>([[OPERATION.id, OPERATION]])}
                operationNamesById={new Map<number, string>([[OPERATION.id, OPERATION.name]])}
                onLocateOperation={vi.fn()}
                isPerfOverlayActive={isPerfOverlayActive}
                perfDeviceTimeNs={perfDeviceTimeNs}
                perfColor={perfColor}
            />
        </MemoryRouter>,
    );

afterEach(cleanup);

describe('op graph panel perf metric', () => {
    it('stays out of the panel while the overlay is off', () => {
        // The panel is the op's permanent detail view, so an unconditional
        // duration row would imply perf data the report may not have.
        renderPanel({ isPerfOverlayActive: false, perfDeviceTimeNs: 12_500_000 });

        expect(screen.queryByText('Kernel duration')).not.toBeInTheDocument();
    });

    it('reads the selected op duration back in the same units as the hover', () => {
        renderPanel({ isPerfOverlayActive: true, perfDeviceTimeNs: 12_500_000, perfColor: perfColorScale(0.6) });

        expect(screen.getByText('Kernel duration')).toBeInTheDocument();
        expect(screen.getByText(formatDuration(12_500_000))).toBeInTheDocument();
    });

    it('names the gap when the selected op has no perf row', () => {
        // Must say why the node has no bar, not show a row that reads as zero.
        renderPanel({ isPerfOverlayActive: true });

        expect(screen.getByText(NO_PERF_DATA_LABEL)).toBeInTheDocument();
    });

    it('carries the node colour into the panel so the two agree', () => {
        const { container } = renderPanel({
            isPerfOverlayActive: true,
            perfDeviceTimeNs: 48_000_000,
            perfColor: perfColorScale(0.95),
        });

        const swatch = container.querySelector('.perf-overlay-op-metric-swatch');

        expect(swatch).toHaveStyle({ backgroundColor: perfColorScale(0.95) });
    });

    it('drops the swatch when there is no duration for it to stand for', () => {
        const { container } = renderPanel({ isPerfOverlayActive: true, perfColor: perfColorScale(0.5) });

        expect(container.querySelector('.perf-overlay-op-metric-swatch')).toBeNull();
    });
});
