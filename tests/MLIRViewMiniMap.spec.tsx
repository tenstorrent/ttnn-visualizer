// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ReactNode } from 'react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import type { GraphBundle } from '../src/model/MLIRJsonModel';

// The MiniMap is a declarative pass-through to React Flow, so the seam we lock
// here is "what props does the view hand it". We stub the whole `@xyflow/react`
// surface the component touches and record the props the real MiniMap would
// have received. `capturedMiniMapProps` is populated on render.
let capturedMiniMapProps: Record<string, unknown> | null = null;

vi.mock('@xyflow/react', () => {
    const Passthrough = ({ children }: { children?: ReactNode }) => children ?? null;
    return {
        ReactFlow: Passthrough,
        ReactFlowProvider: Passthrough,
        Background: () => null,
        Controls: () => null,
        Handle: () => null,
        MiniMap: (props: Record<string, unknown>) => {
            capturedMiniMapProps = props;
            return null;
        },
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

// eslint-disable-next-line import/first
import MLIRViewReactFlow from '../src/components/mlir/MLIRViewReactFlow';

const emptyBundle: GraphBundle = { graphs: [{ id: 'test.mlir', nodes: [] }] };

afterEach(cleanup);
beforeEach(() => {
    capturedMiniMapProps = null;
});

describe('MLIRViewReactFlow MiniMap', () => {
    it('renders the MiniMap as pannable and zoomable', () => {
        render(<MLIRViewReactFlow data={emptyBundle} />);

        expect(capturedMiniMapProps).not.toBeNull();
        expect(capturedMiniMapProps?.pannable).toBe(true);
        expect(capturedMiniMapProps?.zoomable).toBe(true);
    });

    it('keeps the node-colour callback wired alongside the pan/zoom props', () => {
        render(<MLIRViewReactFlow data={emptyBundle} />);

        expect(typeof capturedMiniMapProps?.nodeColor).toBe('function');
    });
});
