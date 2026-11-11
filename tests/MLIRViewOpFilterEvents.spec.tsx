// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { GraphBundle } from '../src/model/MLIRJsonModel';
import { EventLogEvent, FilterSurface } from '../src/definitions/EventLogEvent';

const { recordEvent } = vi.hoisted(() => ({ recordEvent: vi.fn() }));

vi.mock('../src/functions/recordEvent', () => ({ default: recordEvent }));

// The graph canvas is irrelevant to the filter; stub the React Flow surface the view touches.
vi.mock('@xyflow/react', () => {
    const Passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
    return {
        ReactFlow: Passthrough,
        ReactFlowProvider: Passthrough,
        Background: () => null,
        Controls: () => null,
        Handle: () => null,
        MiniMap: () => null,
        Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
        MarkerType: { ArrowClosed: 'arrowclosed' },
        ConnectionLineType: { SmoothStep: 'smoothstep' },
        useReactFlow: () => ({
            fitView: vi.fn(),
            getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
            setViewport: vi.fn(),
            updateNode: vi.fn(),
        }),
        useNodesState: () => [[], vi.fn(), vi.fn()],
        useEdgesState: () => [[], vi.fn(), vi.fn()],
    };
});

// Avoid spawning the layout Web Worker (unavailable under jsdom).
vi.mock('../src/components/mlir/useMlirLayoutWorker', () => ({
    useMlirLayoutWorker: () => ({ interactionIndex: null, runBuild: vi.fn() }),
}));

// Imported after the `vi.mock` factories above so the stubs are registered before it loads.
// eslint-disable-next-line import/first
import MLIRViewReactFlow from '../src/components/mlir/MLIRViewReactFlow';

const emptyBundle: GraphBundle = { graphs: [{ id: 'test.mlir', nodes: [] }] };
const filterUsed = { event: EventLogEvent.FILTER_USED, details: { filter_surface: FilterSurface.MLIR_OP } };

const getInput = () => screen.getByPlaceholderText(/^Filter ops/);

beforeEach(() => {
    recordEvent.mockClear();
});

afterEach(cleanup);

describe('MLIRViewReactFlow op filter usage event', () => {
    it('records once per mount however the query is typed, cleared and retyped', () => {
        render(<MLIRViewReactFlow data={emptyBundle} />);

        fireEvent.change(getInput(), { target: { value: 'tt' } });
        fireEvent.change(getInput(), { target: { value: 'ttnn.matmul' } });
        fireEvent.change(getInput(), { target: { value: '' } });
        fireEvent.change(getInput(), { target: { value: 'conv' } });

        expect(recordEvent).toHaveBeenCalledExactlyOnceWith(filterUsed);
        expect(JSON.stringify(recordEvent.mock.calls)).not.toContain('matmul');
    });

    it('records nothing until a query is entered', () => {
        render(<MLIRViewReactFlow data={emptyBundle} />);

        fireEvent.change(getInput(), { target: { value: '' } });

        expect(recordEvent).not.toHaveBeenCalled();
    });

    it('records again for a fresh mount, as each split-view pane is', () => {
        const { unmount } = render(<MLIRViewReactFlow data={emptyBundle} />);
        fireEvent.change(getInput(), { target: { value: 'tt' } });
        unmount();

        render(<MLIRViewReactFlow data={emptyBundle} />);
        fireEvent.change(getInput(), { target: { value: 'tt' } });

        expect(recordEvent).toHaveBeenCalledTimes(2);
    });
});
