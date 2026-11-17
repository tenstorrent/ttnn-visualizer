// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The footer sliders commit drag steps at transition priority, which only React's real scheduler
 * can show. Testing Library's `render` and `fireEvent` wrap everything in `act()`, which flushes
 * transitions and passive effects synchronously, so the drag specs in `RangeSliderDrag.spec.tsx`
 * would pass with every step committed urgently. These cases mount with `createRoot` outside
 * `act()`, dispatch native events, and wait on real timers.
 *
 * Nothing here imports `@testing-library/react`: importing it switches the act environment on for
 * the whole file.
 */

import { Provider, createStore, useAtomValue } from 'jotai';
import { useEffect, useLayoutEffect } from 'react';
import { Root, createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Range from '../src/components/RangeSlider';
import ROUTES from '../src/definitions/Routes';
import { MAX_TRANSITION_LAG_MS } from '../src/hooks/useTransitionalRange';
import { selectedOperationRangeAtom, selectedPerformanceRangeAtom } from '../src/store/app';

const { mocks } = vi.hoisted(() => {
    const perfIds = Array.from({ length: 60 }, (_, index) => index + 1);

    return {
        mocks: {
            performanceRange: [1, 60] as [number, number],
            operationRange: null as [number, number] | null,
            deviceOperations: [] as unknown[],
            opToPerfIds: [] as { opId: number; perfId: string }[],
            performanceReport: { report: perfIds.map((id) => ({ id: String(id), raw_op_code: `Op${id}` })) },
            // Op ids 10 to 69 map one to one onto perf ids 1 to 60
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

class NoopResizeObserver {
    readonly observe = vi.fn();

    readonly unobserve = vi.fn();

    readonly disconnect = vi.fn();
}

const probe = {
    // How long each probe render blocks, standing in for a view that re-derives from the range
    renderCostMs: 0,
    // Each performance range the probe committed, in order
    committed: [] as string[],
    // Runs in the probe's layout effect, after a commit and before that commit's passive effects
    onLayout: null as ((performance: string) => void) | null,
};

const blockFor = (milliseconds: number) => {
    const end = performance.now() + milliseconds;

    while (performance.now() < end) {
        // Busy-wait: a render that costs this much main-thread time
    }
};

function RangeProbe() {
    const performanceRange = useAtomValue(selectedPerformanceRangeAtom)?.join('-') ?? 'none';
    const operationRange = useAtomValue(selectedOperationRangeAtom)?.join('-') ?? 'none';

    blockFor(probe.renderCostMs);

    useLayoutEffect(() => {
        probe.onLayout?.(performanceRange);
    }, [performanceRange]);

    useEffect(() => {
        probe.committed.push(performanceRange);
    }, [performanceRange]);

    return <p data-testid='probe'>{`performance: ${performanceRange}; operation: ${operationRange}`}</p>;
}

let container: HTMLDivElement;
let root: Root;

const renderRange = () => {
    root.render(
        <Provider store={createStore()}>
            <MemoryRouter initialEntries={[ROUTES.PERFORMANCE]}>
                <Range />
                <RangeProbe />
            </MemoryRouter>
        </Provider>,
    );
};

const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => {
        setTimeout(resolve, milliseconds);
    });

const waitUntil = async (condition: () => boolean, timeoutMs = 2000) => {
    const deadline = performance.now() + timeoutMs;

    while (!condition()) {
        if (performance.now() > deadline) {
            throw new Error('Timed out waiting for the condition');
        }

        // eslint-disable-next-line no-await-in-loop
        await wait(5);
    }
};

const getProbeText = () => container.querySelector('[data-testid="probe"]')?.textContent ?? '';

const getPerformanceMinHandle = () =>
    container.querySelector<HTMLElement>('[aria-label="Performance min range handle"]');

const pressRight = () => {
    getPerformanceMinHandle()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
};

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', false);
    vi.stubGlobal('ResizeObserver', NoopResizeObserver);
    mocks.operationRange = null;
    mocks.deviceOperations = [];
    mocks.opToPerfIds = [];
    probe.renderCostMs = 0;
    probe.committed = [];
    probe.onLayout = null;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    root.unmount();
    container.remove();
    vi.unstubAllGlobals();
    await wait(0);
});

it('moves the handle before the views re-render', async () => {
    renderRange();
    await waitUntil(() => getPerformanceMinHandle() !== null && getProbeText().includes('performance: 1-60'));

    pressRight();
    // The handle's own update is urgent and lands in a microtask; the commit waits for a task
    await Promise.resolve();

    expect(getPerformanceMinHandle()).toHaveProperty('ariaValueNow', '2');
    expect(getProbeText()).toContain('performance: 1-60');

    await waitUntil(() => getProbeText().includes('performance: 2-60'));
});

it('keeps slow views following a continuous drag', async () => {
    const stepGapMs = 16;
    const steps = 40;

    renderRange();
    await waitUntil(() => getPerformanceMinHandle() !== null && getProbeText().includes('performance: 1-60'));

    // A view slower to render than the gap between steps, so every step interrupts its transition
    probe.renderCostMs = 40;
    probe.committed = [];

    const dragStart = performance.now();

    for (let step = 0; step < steps; step++) {
        pressRight();
        // eslint-disable-next-line no-await-in-loop
        await wait(stepGapMs);
    }

    const dragMs = performance.now() - dragStart;
    // Still mid-drag: no keyup has been sent
    const committedDuringDrag = probe.committed.filter((range) => range !== '1-60');

    // Without a guaranteed cadence, the view commits nothing until the drag stops
    expect(committedDuringDrag.length).toBeGreaterThanOrEqual(Math.floor(dragMs / (MAX_TRANSITION_LAG_MS * 3)));
    expect(committedDuringDrag.length).toBeGreaterThanOrEqual(2);

    await waitUntil(() => getProbeText().includes(`performance: ${steps + 1}-60`));
});

it('keeps a linked operation range in step when a drag step lands before the last one’s effects', async () => {
    mocks.operationRange = [10, 69];
    mocks.deviceOperations = mocks.linkedOpToPerfIds;
    mocks.opToPerfIds = mocks.linkedOpToPerfIds;

    renderRange();
    await waitUntil(() => getPerformanceMinHandle() !== null && getProbeText().includes('operation: 10-69'));

    // Right after the first step commits, before its passive effects run, take the second step
    probe.onLayout = (performanceRange) => {
        if (performanceRange === '2-60') {
            probe.onLayout = null;
            queueMicrotask(pressRight);
        }
    };

    pressRight();

    // Perf id 3 belongs to op 12
    await waitUntil(() => getProbeText().includes('performance: 3-60'));
    await wait(50);

    expect(getProbeText()).toBe('performance: 3-60; operation: 12-69');
});
