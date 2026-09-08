// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

import type { EdgeProps } from '@xyflow/react';
import type { OpGraphFlowEdge } from '../src/components/operation-graph/opGraphTypes';

// The edge reads the live transform out of the React Flow store, so the store is
// what a test has to drive. `useStore` is handed the component's own selector,
// which keeps the threshold under test rather than duplicated here.
const zoom = vi.hoisted(() => ({ current: 1 }));

vi.mock('@xyflow/react', () => ({
    BaseEdge: () => null,
    useStore: (selector: (state: { transform: [number, number, number] }) => unknown) =>
        selector({ transform: [0, 0, zoom.current] }),
}));

// eslint-disable-next-line import/first
import OpGraphEdge from '../src/components/operation-graph/OpGraphEdge';

const EDGE_PROPS = {
    id: '1-2-0',
    source: '1',
    target: '2',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 200,
    label: '[1, 32, 32]',
    data: { parallelIndex: 0 },
} as unknown as EdgeProps<OpGraphFlowEdge>;

const renderAtZoom = (value: number) => {
    zoom.current = value;
    const { container } = render(
        <svg>
            <OpGraphEdge {...EDGE_PROPS} />
        </svg>,
    );
    return container.querySelectorAll('.op-graph-edge-label');
};

afterEach(cleanup);

describe('OpGraphEdge label zoom gate', () => {
    it('draws the label at a zoom where it is still readable', () => {
        expect(renderAtZoom(1)).toHaveLength(1);
    });

    it('drops the label once zoomed past legibility', () => {
        // A whole-graph overview sits well below this; the labels there cost a
        // text layout and repaint per pan frame while rendering under 8px.
        expect(renderAtZoom(0.4)).toHaveLength(0);
    });

    it('keeps the label exactly at the threshold', () => {
        expect(renderAtZoom(0.7)).toHaveLength(1);
        cleanup();
        expect(renderAtZoom(0.69)).toHaveLength(0);
    });

    it('has nothing to draw when the edge carries no shape', () => {
        zoom.current = 1;
        const { container } = render(
            <svg>
                <OpGraphEdge
                    {...EDGE_PROPS}
                    label={undefined}
                />
            </svg>,
        );
        expect(container.querySelectorAll('.op-graph-edge-label')).toHaveLength(0);
    });
});
