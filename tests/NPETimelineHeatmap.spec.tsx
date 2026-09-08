// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NPETimelineComponent, { HEATMAP_HEIGHT } from '../src/components/npe/NPETimelineComponent';
import { TimestepData } from '../src/model/NPEModel';
import { calculateLinkCongestionColor } from '../src/components/npe/drawingApi';

// The heat bar summarises n_timesteps into one column per device pixel. Emitting a
// rect per timestep instead meant ~0.008px rects at 196k steps: each screen pixel
// was written hundreds of times and the blended result could hide a spike. #1803

// Non-visited windowed steps carry only the per-step scalar, which is the path the
// heat bar reduces over.
const makeStep = (maxLinkDemand: number): TimestepData =>
    ({
        start_cycle: 0,
        end_cycle: 1,
        active_transfers: [],
        link_demand: [],
        max_link_demand: maxLinkDemand,
        avg_link_demand: 0,
        avg_link_util: 0,
        mcast_write_link_util: 0,
        noc: {},
    }) as unknown as TimestepData;

// Colours go through the canvas, which normalises them; push the expected value
// through the same conversion so the comparison is apples to apples.
const normalise = (color: string): string => {
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = color;
    return String(ctx.fillStyle);
};

let fills: { style: string; args: number[] }[];

const renderTimeline = (steps: TimestepData[], canvasWidth: number) =>
    render(
        <NPETimelineComponent
            timestepList={steps}
            canvasWidth={canvasWidth}
            useTimesteps
            currentTimestep={0}
            cyclesPerTimestep={1}
            selectedZoneList={[]}
            nocType={null}
            navigationCallback={vi.fn()}
        />,
    );

beforeEach(() => {
    fills = [];
    // Recorded as a named function so `this` is the calling context and the current
    // `fillStyle` can be captured alongside the geometry.
    vi.spyOn(CanvasRenderingContext2D.prototype, 'fillRect').mockImplementation(function recordFill(
        this: CanvasRenderingContext2D,
        ...args: number[]
    ) {
        fills.push({ style: String(this.fillStyle), args });
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('NPE timeline heat bar downsampling', () => {
    it('reduces each column to the worst demand it covers so spikes survive', () => {
        // Two columns over four steps. The spike is deliberately NOT the last step in
        // its bucket: with a last-wins (or blended) reduction the column would take
        // the low value and the spike would vanish, which is the bug this guards.
        renderTimeline([makeStep(90), makeStep(5), makeStep(10), makeStep(10)], 2);

        const firstColumn = fills[0];
        expect(firstColumn.style).toBe(normalise(calculateLinkCongestionColor(90, 0, false)));
        expect(firstColumn.style).not.toBe(normalise(calculateLinkCongestionColor(5, 0, false)));
    });

    it('keeps a spike that sits in the middle of a column’s range', () => {
        // Six steps over two columns = three per column, so the spike is neither the
        // first nor the last value in its bucket.
        renderTimeline([makeStep(10), makeStep(80), makeStep(10), makeStep(10), makeStep(10), makeStep(10)], 2);

        expect(fills[0].style).toBe(normalise(calculateLinkCongestionColor(80, 0, false)));
    });

    it('emits at most one rect per column per metric row, not one per timestep', () => {
        const steps = Array.from({ length: 500 }, (_, i) => makeStep((i % 10) * 15));
        renderTimeline(steps, 50);

        // 4 metric rows × 50 columns is the ceiling; run-coalescing only lowers it.
        expect(fills.length).toBeLessThanOrEqual(4 * 50);
        expect(fills.length).toBeLessThan(steps.length);
    });

    it('coalesces neighbouring columns that resolve to the same colour', () => {
        const steps = Array.from({ length: 200 }, () => makeStep(50));
        renderTimeline(steps, 100);

        // Every column is identical, so each of the 4 rows collapses to one rect.
        expect(fills).toHaveLength(4);
    });

    it('spans the full canvas width across the drawn columns', () => {
        const steps = Array.from({ length: 200 }, () => makeStep(50));
        const canvasWidth = 100;
        renderTimeline(steps, canvasWidth);

        const row = fills[0];
        expect(row.args[0]).toBe(0);
        expect(row.args[2]).toBeCloseTo(canvasWidth, 5);
    });

    it('draws nothing for the heat rows when the report has no timesteps', () => {
        renderTimeline([], 100);

        expect(fills).toHaveLength(0);
    });
});

describe('NPE timeline heat bar resolution', () => {
    it('sizes the backing store to device pixels so the bar is not upscaled', () => {
        const original = window.devicePixelRatio;
        Object.defineProperty(window, 'devicePixelRatio', { value: 2, configurable: true });

        try {
            renderTimeline(
                Array.from({ length: 100 }, () => makeStep(50)),
                100,
            );
            const canvas = document.querySelector('canvas') as HTMLCanvasElement;
            expect(canvas.width).toBe(200);
            expect(canvas.height).toBe(HEATMAP_HEIGHT * 2);
        } finally {
            Object.defineProperty(window, 'devicePixelRatio', { value: original, configurable: true });
        }
    });

    // Note: the `columnCount` clamp to `dataSize` is deliberately NOT asserted here.
    // Run-coalescing merges equal-coloured neighbours and colour boundaries always
    // fall on step boundaries, so the drawn rects are identical whether or not the
    // clamp is applied — it bounds the work done, not the output, and no rendering
    // assertion can distinguish it. The reduction contract it relies on is covered
    // directly in `reduceToColumns.spec.ts`.
});
