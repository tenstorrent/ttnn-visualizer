// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

// Sentinel palette to prove swatches source their colour from GRAPH_COLORS.
const PALETTE = vi.hoisted(() => ({
    opNode: '#111111',
    group: '#222222',
    sectionGroup: '#333333',
    inputNode: '#444444',
    outputNode: '#555555',
    selected: '#666666',
}));

vi.mock('../src/definitions/GraphColors', () => ({
    GRAPH_COLORS: PALETTE,
}));

// eslint-disable-next-line import/first
import MlirNodeColorLegend from '../src/components/mlir/MlirNodeColorLegend';

afterEach(cleanup);

const swatchColors = (container: HTMLElement): string[] =>
    Array.from(container.querySelectorAll<HTMLElement>('.mlir-node-color-legend-swatch')).map((el) =>
        el.style.getPropertyValue('--legend-swatch-color'),
    );

describe('MlirNodeColorLegend', () => {
    it('renders collapsed by default (no category rows until opened)', () => {
        const { container } = render(<MlirNodeColorLegend />);
        expect(screen.getByRole('button', { name: /show node colour legend/i })).toBeInTheDocument();
        expect(container.querySelectorAll('.mlir-node-color-legend-item')).toHaveLength(0);
    });

    it('expands to reveal every node category label', () => {
        render(<MlirNodeColorLegend />);
        fireEvent.click(screen.getByRole('button', { name: /show node colour legend/i }));

        for (const label of [
            'Operation',
            'Subgraph / group',
            'Section group',
            'Feeds selection',
            'Consumed by selection',
            'Selected node',
        ]) {
            expect(screen.getByText(label)).toBeInTheDocument();
        }
        // Toggle now advertises the collapse affordance.
        expect(screen.getByRole('button', { name: /hide node colour legend/i })).toBeInTheDocument();
    });

    it('sources each swatch colour from GRAPH_COLORS (no hard-coded duplicates)', () => {
        const { container } = render(<MlirNodeColorLegend />);
        fireEvent.click(screen.getByRole('button', { name: /show node colour legend/i }));

        expect(swatchColors(container)).toEqual([
            PALETTE.opNode,
            PALETTE.group,
            PALETTE.sectionGroup,
            PALETTE.inputNode,
            PALETTE.outputNode,
            PALETTE.selected,
        ]);
    });

    it('renders the selected-node swatch as a ring rather than a fill', () => {
        const { container } = render(<MlirNodeColorLegend />);
        fireEvent.click(screen.getByRole('button', { name: /show node colour legend/i }));

        const rings = container.querySelectorAll('.mlir-node-color-legend-swatch.is-ring');
        expect(rings).toHaveLength(1);
    });
});
