// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import BufferSummaryPlotControls from '../src/components/buffer-summary/BufferSummaryPlotControls';
import {
    selectedBufferSummaryTabAtom,
    topNAnnotationCountAtom,
    topNAnnotationEnabledAtom,
    topNAnnotationModeAtom,
} from '../src/store/app';
import { TAB_IDS } from '../src/definitions/BufferSummary';
import { TopNAnnotationMode, TopNAnnotationStatus } from '../src/functions/topNAnnotations';
import { AtomProvider, AtomProviderInitialValues } from './helpers/atomProvider';

const availabilityMock = vi.fn();

vi.mock('../src/hooks/useTopNAnnotations', () => ({
    useTopNAnnotationAvailability: (...args: unknown[]) => availabilityMock(...args),
}));

// Render Blueprint Tooltip transparently so we can assert on rendered text without
// dealing with portal mounts in jsdom.
vi.mock('@blueprintjs/core', async () => {
    const original = await vi.importActual<typeof import('@blueprintjs/core')>('@blueprintjs/core');
    return {
        ...original,
        Tooltip: ({ children, content }: { children: React.ReactNode; content: React.ReactNode }) => (
            <div
                data-testid='tooltip-host'
                data-content={typeof content === 'string' ? content : ''}
            >
                {children}
            </div>
        ),
    };
});

const renderControls = (overrides: AtomProviderInitialValues = []) =>
    render(
        <AtomProvider
            initialValues={[
                [selectedBufferSummaryTabAtom, TAB_IDS.L1],
                [topNAnnotationEnabledAtom, false],
                [topNAnnotationModeAtom, TopNAnnotationMode.PERF_TIME],
                [topNAnnotationCountAtom, 10],
                ...overrides,
            ]}
        >
            <BufferSummaryPlotControls />
        </AtomProvider>,
    );

const getTopNSwitch = (): HTMLInputElement =>
    screen.getByLabelText(/highlight top/i, { selector: 'input[type="checkbox"]' }) as HTMLInputElement;

/**
 * Convenience builder for the `statusByMode` map returned by
 * `useTopNAnnotationAvailability`. The first arg covers all perf-derived modes
 * (they share the same source pipeline), the second covers L1 fullness.
 * Individual modes can be overridden via the third arg so the NO_DATA /
 * per-metric availability cases stay readable.
 */
const buildStatusByMode = (
    perfStatus: TopNAnnotationStatus,
    l1Status: TopNAnnotationStatus,
    overrides: Partial<Record<TopNAnnotationMode, TopNAnnotationStatus>> = {},
): Record<TopNAnnotationMode, TopNAnnotationStatus> => ({
    [TopNAnnotationMode.PERF_TIME]: perfStatus,
    [TopNAnnotationMode.PERF_OP_TO_OP_GAP]: perfStatus,
    [TopNAnnotationMode.PERF_DRAM_PERCENT]: perfStatus,
    [TopNAnnotationMode.PERF_FLOPS_PERCENT]: perfStatus,
    [TopNAnnotationMode.L1_FULLNESS]: l1Status,
    ...overrides,
});

beforeEach(() => {
    availabilityMock.mockReset();
});

afterEach(cleanup);

describe('BufferSummaryPlotControls top-N (#1517)', () => {
    it('disables the toggle and surfaces the UNAVAILABLE tooltip when no perf report is loaded', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.UNAVAILABLE, TopNAnnotationStatus.READY),
            perfAggregatesByOpId: new Map(),
            l1PressureByOpId: new Map(),
        });

        renderControls();

        expect(getTopNSwitch()).toBeDisabled();
        const cluster = screen.getByTestId('top-n-controls');
        const tooltipHost = cluster.querySelector('[data-testid="tooltip-host"]');
        expect(tooltipHost?.getAttribute('data-content')).toMatch(/Load a performance report/i);
    });

    it('disables the toggle and surfaces the UNLINKED tooltip when reports do not line up', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.UNLINKED, TopNAnnotationStatus.READY),
            perfAggregatesByOpId: new Map(),
            l1PressureByOpId: new Map(),
        });

        renderControls();

        expect(getTopNSwitch()).toBeDisabled();
        const cluster = screen.getByTestId('top-n-controls');
        const tooltipHost = cluster.querySelector('[data-testid="tooltip-host"]');
        expect(tooltipHost?.getAttribute('data-content')).toMatch(/doesn't match/i);
    });

    it('enables the toggle when the selected mode is READY', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.READY, TopNAnnotationStatus.READY),
            perfAggregatesByOpId: new Map([[1, { opId: 1, deviceTimeNs: 100, rowCount: 1 }]]),
            l1PressureByOpId: new Map(),
        });

        renderControls();

        expect(getTopNSwitch()).not.toBeDisabled();
    });

    it('marks the L1 fullness option disabled when L1 is UNAVAILABLE (e.g. DRAM tab)', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.READY, TopNAnnotationStatus.UNAVAILABLE),
            perfAggregatesByOpId: new Map([[1, { opId: 1, deviceTimeNs: 100, rowCount: 1 }]]),
            l1PressureByOpId: null,
        });

        renderControls([[selectedBufferSummaryTabAtom, TAB_IDS.DRAM]]);

        const modeSelect = screen.getByLabelText(/Top-N annotation mode/i) as HTMLSelectElement;
        const l1Option = Array.from(modeSelect.options).find(
            (option) => option.value === TopNAnnotationMode.L1_FULLNESS,
        );
        expect(l1Option).toBeDefined();
        expect(l1Option).toBeDisabled();
    });

    it('disables the toggle when the active mode is L1 fullness but L1 is unavailable', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.READY, TopNAnnotationStatus.UNAVAILABLE),
            perfAggregatesByOpId: new Map([
                [
                    1,
                    {
                        opId: 1,
                        deviceTimeNs: 100,
                        rowCount: 1,
                        opToOpGapNs: null,
                        dramPercent: null,
                        flopsPercent: null,
                    },
                ],
            ]),
            l1PressureByOpId: null,
        });

        renderControls([[topNAnnotationModeAtom, TopNAnnotationMode.L1_FULLNESS]]);

        expect(getTopNSwitch()).toBeDisabled();
    });

    it('renders all top-N modes in the dropdown (kernel duration, op-to-op gap, DRAM %, FLOPS %, L1 fullness)', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.READY, TopNAnnotationStatus.READY),
            perfAggregatesByOpId: new Map([
                [
                    1,
                    {
                        opId: 1,
                        deviceTimeNs: 100,
                        rowCount: 1,
                        opToOpGapNs: null,
                        dramPercent: null,
                        flopsPercent: null,
                    },
                ],
            ]),
            l1PressureByOpId: new Map(),
        });

        renderControls();

        const modeSelect = screen.getByLabelText(/Top-N annotation mode/i) as HTMLSelectElement;
        const values = Array.from(modeSelect.options).map((option) => option.value);
        expect(values).toEqual([
            TopNAnnotationMode.PERF_TIME,
            TopNAnnotationMode.PERF_OP_TO_OP_GAP,
            TopNAnnotationMode.PERF_DRAM_PERCENT,
            TopNAnnotationMode.PERF_FLOPS_PERCENT,
            TopNAnnotationMode.L1_FULLNESS,
        ]);
    });

    it('disables every perf-derived mode option together when perf is UNAVAILABLE, but leaves L1 fullness selectable when ready', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.UNAVAILABLE, TopNAnnotationStatus.READY),
            perfAggregatesByOpId: new Map(),
            l1PressureByOpId: new Map(),
        });

        renderControls();

        const modeSelect = screen.getByLabelText(/Top-N annotation mode/i) as HTMLSelectElement;
        const optionsByValue = new Map(Array.from(modeSelect.options).map((option) => [option.value, option]));
        expect(optionsByValue.get(TopNAnnotationMode.PERF_TIME)).toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.PERF_OP_TO_OP_GAP)).toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.PERF_DRAM_PERCENT)).toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.PERF_FLOPS_PERCENT)).toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.L1_FULLNESS)).not.toBeDisabled();
        // The select itself stays interactive — user can still pick the one ready mode.
        expect(modeSelect).not.toBeDisabled();
    });

    it('surfaces a perf-specific tooltip for each perf-derived mode when perf is UNAVAILABLE', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.UNAVAILABLE, TopNAnnotationStatus.READY),
            perfAggregatesByOpId: new Map(),
            l1PressureByOpId: new Map(),
        });

        const cases: Array<[TopNAnnotationMode, RegExp]> = [
            [TopNAnnotationMode.PERF_TIME, /kernel-duration/i],
            [TopNAnnotationMode.PERF_OP_TO_OP_GAP, /op-to-op gap/i],
            [TopNAnnotationMode.PERF_DRAM_PERCENT, /DRAM-utilization/i],
            [TopNAnnotationMode.PERF_FLOPS_PERCENT, /FLOPS-utilization/i],
        ];

        for (const [mode, copyRegex] of cases) {
            const { unmount } = renderControls([[topNAnnotationModeAtom, mode]]);
            const cluster = screen.getByTestId('top-n-controls');
            const tooltipHost = cluster.querySelector('[data-testid="tooltip-host"]');
            expect(tooltipHost?.getAttribute('data-content')).toMatch(copyRegex);
            unmount();
        }
    });

    // Regression for "op-to-op gap doesn't produce any results" — when the
    // perf report is loaded and linked but a particular column (op-to-op gap,
    // DRAM %, FLOPS %) has no usable values, that single mode should resolve
    // to NO_DATA: the option grays out and the active-mode tooltip explains
    // *why* without misleading the user into reloading the report.
    it('marks individual perf modes as NO_DATA when the column has no usable values', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.READY, TopNAnnotationStatus.READY, {
                [TopNAnnotationMode.PERF_OP_TO_OP_GAP]: TopNAnnotationStatus.NO_DATA,
                [TopNAnnotationMode.PERF_DRAM_PERCENT]: TopNAnnotationStatus.NO_DATA,
                [TopNAnnotationMode.PERF_FLOPS_PERCENT]: TopNAnnotationStatus.NO_DATA,
            }),
            perfAggregatesByOpId: new Map([
                [
                    1,
                    {
                        opId: 1,
                        deviceTimeNs: 100,
                        rowCount: 1,
                        opToOpGapNs: null,
                        dramPercent: null,
                        flopsPercent: null,
                    },
                ],
            ]),
            l1PressureByOpId: new Map(),
        });

        renderControls();

        const modeSelect = screen.getByLabelText(/Top-N annotation mode/i) as HTMLSelectElement;
        const optionsByValue = new Map(Array.from(modeSelect.options).map((option) => [option.value, option]));
        expect(optionsByValue.get(TopNAnnotationMode.PERF_TIME)).not.toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.PERF_OP_TO_OP_GAP)).toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.PERF_DRAM_PERCENT)).toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.PERF_FLOPS_PERCENT)).toBeDisabled();
        expect(optionsByValue.get(TopNAnnotationMode.L1_FULLNESS)).not.toBeDisabled();
    });

    it('surfaces a NO_DATA tooltip when the active perf mode column is empty in the loaded report', () => {
        availabilityMock.mockReturnValue({
            statusByMode: buildStatusByMode(TopNAnnotationStatus.READY, TopNAnnotationStatus.READY, {
                [TopNAnnotationMode.PERF_OP_TO_OP_GAP]: TopNAnnotationStatus.NO_DATA,
            }),
            perfAggregatesByOpId: new Map(),
            l1PressureByOpId: new Map(),
        });

        renderControls([[topNAnnotationModeAtom, TopNAnnotationMode.PERF_OP_TO_OP_GAP]]);

        expect(getTopNSwitch()).toBeDisabled();
        const cluster = screen.getByTestId('top-n-controls');
        const tooltipHost = cluster.querySelector('[data-testid="tooltip-host"]');
        expect(tooltipHost?.getAttribute('data-content')).toMatch(/doesn't include op-to-op gap/i);
    });
});
