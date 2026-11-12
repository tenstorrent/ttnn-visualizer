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
import { useAtomValue, useSetAtom } from 'jotai';
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

// Writes the performance range the way a view outside the slider can (`Performance.tsx` resets it)
function RangeWriter() {
    const setPerformanceRange = useSetAtom(selectedPerformanceRangeAtom);

    return (
        <button
            type='button'
            onClick={() => setPerformanceRange([3, 7])}
        >
            Write performance range
        </button>
    );
}

const renderRange = (route: string = ROUTES.PERFORMANCE) =>
    render(
        <TestProviders initialEntries={[route]}>
            <Range />
            <RangeProbe />
            <RangeWriter />
        </TestProviders>,
    );

const getPerformanceMinHandle = () => screen.getByRole('slider', { name: 'Performance min range handle' });
const getOperationMinHandle = () => screen.getByRole('slider', { name: 'Operation min range handle' });

// Ops 10 to 19 map to perf ids 1 to 10, with gaps where a test needs the nearest-match fallback
const buildMapping = (opIds: number[]) => opIds.map((opId) => ({ opId, perfId: String(opId - 9) }));

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

it('shows the new track’s selection, not the stale drag copy, when the track changes', async () => {
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

it('shows the reset range when Reset is pressed mid-drag', async () => {
    renderRange();

    fireEvent.keyDown(await screen.findByRole('slider', { name: 'Performance min range handle' }), {
        key: 'ArrowRight',
    });
    expect(await screen.findByText('performance: 2-10')).toBeInTheDocument();

    // No keyup: the drag is never released
    fireEvent.click(screen.getByRole('button', { name: 'Reset performance range' }));

    expect(await screen.findByText('performance: 1-10')).toBeInTheDocument();
    expect(getPerformanceMinHandle()).toHaveAttribute('aria-valuenow', '1');
    expect(screen.getByLabelText('Performance min value')).toHaveValue('1');
});

it('releases the drag when focus leaves the handle before keyup', async () => {
    renderRange();

    const handle = await screen.findByRole('slider', { name: 'Performance min range handle' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(await screen.findByText('performance: 2-10')).toBeInTheDocument();

    fireEvent.focusOut(getPerformanceMinHandle());
    fireEvent.click(screen.getByRole('button', { name: 'Write performance range' }));

    expect(await screen.findByText('performance: 3-7')).toBeInTheDocument();
    expect(getPerformanceMinHandle()).toHaveAttribute('aria-valuenow', '3');
});

it('applies a typed value after a drag to the handle and the views', async () => {
    renderRange();

    const handle = await screen.findByRole('slider', { name: 'Performance min range handle' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    fireEvent.keyUp(getPerformanceMinHandle(), { key: 'ArrowRight' });
    expect(await screen.findByText('performance: 2-10')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Performance min value'), { target: { value: '5' } });

    expect(await screen.findByText('performance: 5-10')).toBeInTheDocument();
    expect(getPerformanceMinHandle()).toHaveAttribute('aria-valuenow', '5');
});

it('carries an operation drag onto the linked performance range', async () => {
    mocks.operationRange = [10, 19];
    mocks.deviceOperations = mocks.linkedOpToPerfIds;
    mocks.opToPerfIds = mocks.linkedOpToPerfIds;

    renderRange(ROUTES.OPERATIONS);

    const handle = await screen.findByRole('slider', { name: 'Operation min range handle' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    // Op 11 belongs to perf id 2 in the mapping
    expect(await screen.findByText('operation: 11-19')).toBeInTheDocument();
    expect(await screen.findByText('performance: 2-10')).toBeInTheDocument();
});

it('snaps a linked operation with no exact match to the nearest mapped op', async () => {
    // Ops 11 and 12 have no perf row
    const mapping = buildMapping([10, 13, 14, 15, 16, 17, 18, 19]);

    mocks.operationRange = [10, 19];
    mocks.deviceOperations = mapping;
    mocks.opToPerfIds = mapping;

    renderRange(ROUTES.OPERATIONS);

    fireEvent.keyDown(await screen.findByRole('slider', { name: 'Operation min range handle' }), {
        key: 'ArrowRight',
    });
    expect(await screen.findByText('operation: 11-19')).toBeInTheDocument();

    fireEvent.keyDown(getOperationMinHandle(), { key: 'ArrowRight' });

    // Op 12 is nearest to op 13, whose perf id is 4
    expect(await screen.findByText('operation: 12-19')).toBeInTheDocument();
    expect(await screen.findByText('performance: 4-10')).toBeInTheDocument();
});

it('uses the first perf id when an op appears more than once in the mapping', async () => {
    const mapping = [{ opId: 10, perfId: '3' }, { opId: 10, perfId: '5' }, ...buildMapping([11, 12, 13, 19])];

    mocks.operationRange = [10, 19];
    mocks.deviceOperations = mapping;
    mocks.opToPerfIds = mapping;

    renderRange(ROUTES.OPERATIONS);

    const handle = await screen.findByRole('slider', { name: 'Operation min range handle' });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(await screen.findByText('operation: 11-19')).toBeInTheDocument();

    fireEvent.keyDown(getOperationMinHandle(), { key: 'ArrowLeft' });

    expect(await screen.findByText('operation: 10-19')).toBeInTheDocument();
    expect(await screen.findByText('performance: 3-10')).toBeInTheDocument();
});
