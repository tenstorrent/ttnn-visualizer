// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore, useAtomValue } from 'jotai';
import { useState } from 'react';

import { activePerformanceReportAtom, activeProfilerReportAtom } from '../src/store/app';
import type { ReportFolder } from '../src/definitions/Reports';

// `OperationGraphReactFlow` cannot mount under jsdom — React Flow needs a
// measured container and the worker a real `Worker` — so this mirrors its reset
// in isolation, render-phase adjustment included. Contract: intent drops on
// either report identity changing. #1880
const useOverlayIntent = () => {
    const [isEnabled, setIsEnabled] = useState(false);
    const profilerPath = useAtomValue(activeProfilerReportAtom)?.path ?? null;
    const performancePath = useAtomValue(activePerformanceReportAtom)?.path ?? null;
    const [scope, setScope] = useState({ profiler: profilerPath, performance: performancePath });
    if (scope.profiler !== profilerPath || scope.performance !== performancePath) {
        setScope({ profiler: profilerPath, performance: performancePath });
        setIsEnabled(false);
    }
    return [isEnabled, setIsEnabled] as const;
};

const TOGGLE_LABEL = 'toggle overlay';

// Driven and read through the DOM, not module scope, so no assertion depends on
// when the hook happens to run.
const OverlayIntentProbe = () => {
    const [isEnabled, setIsEnabled] = useOverlayIntent();
    return (
        <button
            type='button'
            aria-label={TOGGLE_LABEL}
            onClick={() => setIsEnabled(true)}
        >
            {String(isEnabled)}
        </button>
    );
};

const reportFolder = (name: string) => ({ path: `/reports/${name}`, reportName: name }) as ReportFolder;

const renderProbe = () => {
    const store = createStore();
    render(
        <Provider store={store}>
            <OverlayIntentProbe />
        </Provider>,
    );
    return store;
};

const enableOverlay = () => fireEvent.click(screen.getByLabelText(TOGGLE_LABEL));

const intent = () => screen.getByLabelText(TOGGLE_LABEL).textContent;

afterEach(cleanup);

describe('op graph perf overlay reset', () => {
    it('drops overlay intent when the profiler report changes', () => {
        const store = renderProbe();
        enableOverlay();

        expect(intent()).toBe('true');

        act(() => store.set(activeProfilerReportAtom, reportFolder('resnet50')));

        expect(intent()).toBe('false');
    });

    it('drops overlay intent when the performance report changes', () => {
        // A perf swap is the more dangerous of the two: the graph is unchanged,
        // so a stale overlay looks plausible while encoding a different run.
        const store = renderProbe();
        enableOverlay();
        act(() => store.set(activePerformanceReportAtom, reportFolder('resnet50-perf')));

        expect(intent()).toBe('false');
    });

    it('does not re-enable itself when a report is swapped back', () => {
        // The regression: holding intent while the switch reads derived active
        // state let a report re-entering READY turn the overlay back on.
        const store = renderProbe();
        const first = reportFolder('resnet50');
        act(() => store.set(activeProfilerReportAtom, first));
        enableOverlay();
        act(() => store.set(activeProfilerReportAtom, reportFolder('bert')));

        expect(intent()).toBe('false');

        act(() => store.set(activeProfilerReportAtom, first));

        expect(intent()).toBe('false');
    });

    it('leaves intent alone while the reports hold still', () => {
        // A reset firing on every render would make the switch unusable.
        const store = renderProbe();
        const report = reportFolder('resnet50');
        act(() => store.set(activeProfilerReportAtom, report));
        enableOverlay();
        act(() => store.set(activeProfilerReportAtom, report));

        expect(intent()).toBe('true');
    });

    it('survives the same report arriving as a rebuilt object', () => {
        // Restoring an instance or refetching writes a fresh `ReportFolder` for
        // the loaded report; keyed on object identity that reads as a swap.
        const store = renderProbe();
        act(() => store.set(activeProfilerReportAtom, reportFolder('resnet50')));
        enableOverlay();
        act(() => store.set(activeProfilerReportAtom, reportFolder('resnet50')));

        expect(intent()).toBe('true');
    });
});
