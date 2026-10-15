// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyChipRenderer } from '../src/components/npe/EmptyChipRenderer';

// [y, x] pairs, as `useNodeType` hands them over: Quasar-32's dispatch engines at 10-1, 10-6 and 1-6.
const DISPATCH = [
    [1, 10],
    [6, 10],
    [6, 1],
];

const renderChip = (isAnnotatingCores: boolean) =>
    render(
        <EmptyChipRenderer
            id={0}
            width={11}
            height={8}
            cores={[[2, 2]]}
            dram={[[7, 2]]}
            dispatch={DISPATCH}
            onEmptyCellClick={() => {}}
            isAnnotatingCores={isAnnotatingCores}
            TENSIX_SIZE={10}
            renderChipId={false}
        />,
    );

afterEach(cleanup);

describe('EmptyChipRenderer dispatch engines (#1847)', () => {
    it('labels each dispatch engine at its own tile', () => {
        const { container } = renderChip(true);
        const labels = [...container.querySelectorAll<HTMLElement>('.node-type-dispatch')];

        expect(labels.map((label) => label.textContent)).toEqual(['D', 'D', 'D']);
        // A tile's grid column is x + 1 and its row y + 1, so this pins the [y, x] reading.
        const placements = labels
            .map((label) => {
                const tile = label.parentElement!;
                return `${tile.style.gridColumn}-${tile.style.gridRow}`;
            })
            .sort();
        expect(placements).toEqual(['11-2', '11-7', '2-7'].sort());
    });

    it('keeps Tensix and DRAM labels distinct from dispatch', () => {
        const { container } = renderChip(true);

        expect(container.querySelector('.node-type-c')?.textContent).toBe('T');
        expect(container.querySelector('.node-type-d')?.textContent).toBe('d');
    });

    it('draws no labels while cores are not annotated', () => {
        const { container } = renderChip(false);

        expect(container.querySelectorAll('.node-type-label')).toHaveLength(0);
    });
});
