// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The footer sliders commit each drag step inside a transition, so the handle can move before the
 * views it filters have re-rendered. Views must still follow the drag rather than wait for the
 * release: these cases drive a handle with arrow keys, which fire `onChange` on keydown and
 * `onRelease` only on keyup, and read the committed range from a probe outside the slider.
 */

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useAtomValue } from 'jotai';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Range from '../src/components/RangeSlider';
import ROUTES from '../src/definitions/Routes';
import { selectedOperationRangeAtom, selectedPerformanceRangeAtom } from '../src/store/app';
import { TestProviders } from './helpers/TestProviders';
import { installCapturingResizeObserver } from './helpers/capturingResizeObserver';

// Range copies these into state from effects keyed on their identity, so each must be stable
const { mocks } = vi.hoisted(() => {
    const perfIds = Array.from({ length: 10 }, (_, index) => index + 1);

    return {
        mocks: {
            performanceRange: [1, 10] as [number, number] | null,
            operationRange: null as [number, number] | null,
            deviceOperations: [] as unknown[],
            opToPerfIds: [] as { opId: number; perfId: string | undefined }[],
            performanceReport: { report: perfIds.map((id) => ({ id: String(id), raw_op_code: `Op${id}` })) },
            linkedOpToPerfIds: perfIds.map((id) => ({ opId: id + 9, perfId: String(id) })),
        },
    };
});

vi.mock('../src/hooks/useAPI', () => ({
    useGetClusterDescription: () => ({ error: null }),
    useGetDeviceOperationListPerf: () => mocks.deviceOperations,
    useOpToPerfIdFiltered: () => mocks.opToPerfIds,
    useOperationListRange: () => mocks.operationRange,
    useOperationsList: () => ({ data: undefined }),
    usePerformanceRange: () => mocks.performanceRange,
    usePerformanceReport: () => ({ data: mocks.performanceReport, error: null }),
}));

function RangeProbe() {
    const performanceRange = useAtomValue(selectedPerformanceRangeAtom);
    const operationRange = useAtomValue(selectedOperationRangeAtom);

    return (
        <>
            <p>{`performance: ${performanceRange?.join('-') ?? 'none'}`}</p>
            <p>{`operation: ${operationRange?.join('-') ?? 'none'}`}</p>
        </>
    );
}

const renderRange = () =>
    render(
        <TestProviders initialEntries={[ROUTES.PERFORMANCE]}>
            <Range />
            <RangeProbe />
        </TestProviders>,
    );

const getPerformanceMinHandle = () => screen.getByRole('slider', { name: 'Performance min range handle' });

beforeEach(() => {
    installCapturingResizeObserver();
    mocks.performanceRange = [1, 10];
    mocks.operationRange = null;
    mocks.deviceOperations = [];
    mocks.opToPerfIds = [];
});

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

it('commits each drag step before the handle is released', async () => {
    renderRange();

    const handle = await screen.findByRole('slider', { name: 'Performance min range handle' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(getPerformanceMinHandle()).toHaveAttribute('aria-valuenow', '2');
    expect(await screen.findByText('performance: 2-10')).toBeInTheDocument();

    fireEvent.keyDown(getPerformanceMinHandle(), { key: 'ArrowRight' });
    fireEvent.keyDown(getPerformanceMinHandle(), { key: 'ArrowRight' });

    // Still mid-drag: no keyup yet, so no `onRelease`
    expect(await screen.findByText('performance: 4-10')).toBeInTheDocument();
    expect(getPerformanceMinHandle()).toHaveAttribute('aria-valuenow', '4');
});

it('keeps the handle where it was released', async () => {
    renderRange();

    const handle = await screen.findByRole('slider', { name: 'Performance min range handle' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyDown(getPerformanceMinHandle(), { key: 'ArrowRight' });
    fireEvent.keyUp(getPerformanceMinHandle(), { key: 'ArrowRight' });

    expect(await screen.findByText('performance: 3-10')).toBeInTheDocument();
    expect(getPerformanceMinHandle()).toHaveAttribute('aria-valuenow', '3');
});

it('drops a drag in progress when the track changes', async () => {
    const { rerender } = renderRange();

    const handle = await screen.findByRole('slider', { name: 'Performance min range handle' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(await screen.findByText('performance: 2-10')).toBeInTheDocument();

    // A new report narrows the track mid-drag; Range resets the selection to it
    mocks.performanceRange = [5, 8];
    rerender(
        <TestProviders initialEntries={[ROUTES.PERFORMANCE]}>
            <Range />
            <RangeProbe />
        </TestProviders>,
    );

    expect(await screen.findByText('performance: 5-8')).toBeInTheDocument();
    expect(getPerformanceMinHandle()).toHaveAttribute('aria-valuenow', '5');
});

it('carries a performance drag onto a linked memory report’s operation range', async () => {
    mocks.operationRange = [10, 19];
    mocks.deviceOperations = mocks.linkedOpToPerfIds;
    mocks.opToPerfIds = mocks.linkedOpToPerfIds;

    renderRange();

    const handle = await screen.findByRole('slider', { name: 'Performance min range handle' });

    expect(await screen.findByText('operation: 10-19')).toBeInTheDocument();

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    // Perf id 2 belongs to op 11 in the mapping
    expect(await screen.findByText('performance: 2-10')).toBeInTheDocument();
    expect(await screen.findByText('operation: 11-19')).toBeInTheDocument();
});
