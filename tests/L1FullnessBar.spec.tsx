// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import L1FullnessBar from '../src/components/performance/L1FullnessBar';
import { CellColour } from '../src/definitions/CellColour';

const SEGMENT_SELECTOR = '.l1-fullness-bar__track .l1-fullness-bar__segment';
const LEGEND_ITEM_SELECTOR = '.l1-fullness-bar__legend-item';

function widthsOf(container: HTMLElement): number[] {
    return Array.from(container.querySelectorAll<HTMLDivElement>(SEGMENT_SELECTOR)).map((el) =>
        parseFloat(el.style.width),
    );
}

function legendOf(container: HTMLElement): Array<{ label: string; value: string }> {
    return Array.from(container.querySelectorAll<HTMLLIElement>(LEGEND_ITEM_SELECTOR)).map((item) => ({
        label: item.querySelector('.l1-fullness-bar__legend-label')?.textContent ?? '',
        value: item.querySelector('.l1-fullness-bar__legend-value')?.textContent ?? '',
    }));
}

afterEach(cleanup);

describe('L1FullnessBar', () => {
    it('renders used, largest-free and fragmented-free segments that sum to 100%', () => {
        const { container } = render(
            <L1FullnessBar
                fullnessPercent={40}
                largestFreePercent={45}
                usedColour={CellColour.Yellow}
            />,
        );

        const widths = widthsOf(container);
        expect(widths).toEqual([40, 45, 15]);
        expect(widths.reduce((sum, w) => sum + w, 0)).toBe(100);
    });

    it('clamps fullness above 100 and never renders negative free segments', () => {
        const { container } = render(
            <L1FullnessBar
                fullnessPercent={120}
                largestFreePercent={30}
                usedColour={CellColour.Red}
            />,
        );

        const widths = widthsOf(container);
        expect(widths).toEqual([100]);
    });

    it('treats null largestFreePercent as no contiguous-free segment', () => {
        const { container } = render(
            <L1FullnessBar
                fullnessPercent={25}
                largestFreePercent={null}
                usedColour={CellColour.White}
            />,
        );

        const widths = widthsOf(container);
        expect(widths).toEqual([25, 75]);
        expect(
            container.querySelector('.l1-fullness-bar__track .l1-fullness-bar__largest-free'),
        ).not.toBeInTheDocument();
        expect(
            container.querySelector('.l1-fullness-bar__track .l1-fullness-bar__fragmented-free'),
        ).toBeInTheDocument();
    });

    it('omits sub-pixel segments below the visibility threshold', () => {
        const { container } = render(
            <L1FullnessBar
                fullnessPercent={0.1}
                largestFreePercent={99.8}
                usedColour={CellColour.White}
            />,
        );

        expect(container.querySelector('.l1-fullness-bar__track .l1-fullness-bar__used')).not.toBeInTheDocument();
        expect(container.querySelector('.l1-fullness-bar__track .l1-fullness-bar__largest-free')).toBeInTheDocument();
        expect(
            container.querySelector('.l1-fullness-bar__track .l1-fullness-bar__fragmented-free'),
        ).not.toBeInTheDocument();
    });

    it('applies the threshold colour class to the used segment and its legend swatch', () => {
        const { container } = render(
            <L1FullnessBar
                fullnessPercent={60}
                largestFreePercent={20}
                usedColour={CellColour.Red}
            />,
        );

        const usedSegment = container.querySelector('.l1-fullness-bar__track .l1-fullness-bar__used');
        expect(usedSegment).toHaveClass('red');

        const usedSwatch = container.querySelector('.l1-fullness-bar__legend-swatch.l1-fullness-bar__used');
        expect(usedSwatch).toHaveClass('red');
    });

    it('renders a three-row legend with the segment names and current percentages', () => {
        const { container } = render(
            <L1FullnessBar
                fullnessPercent={40}
                largestFreePercent={45}
                usedColour={CellColour.Yellow}
            />,
        );

        expect(legendOf(container)).toEqual([
            { label: 'Used', value: '40%' },
            { label: 'Largest free', value: '45%' },
            { label: 'Fragmented free', value: '15%' },
        ]);
    });

    it('keeps all three legend rows even when a segment is hidden in the bar', () => {
        const { container } = render(
            <L1FullnessBar
                fullnessPercent={0.1}
                largestFreePercent={99.8}
                usedColour={CellColour.White}
            />,
        );

        const widths = widthsOf(container);
        expect(widths).toHaveLength(1);

        expect(legendOf(container)).toEqual([
            { label: 'Used', value: '0.1%' },
            { label: 'Largest free', value: '99.8%' },
            { label: 'Fragmented free', value: '0.1%' },
        ]);
    });
});
