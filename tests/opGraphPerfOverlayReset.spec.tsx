// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Provider, createStore, useAtomValue } from 'jotai';
import { useState } from 'react';

import { activePerformanceReportAtom, activeProfilerReportAtom } from '../src/store/app';
import type { ReportFolder } from '../src/definitions/Reports';

// The reset lives in `OperationGraphReactFlow`, which cannot mount under jsdom
// (React Flow needs a measured container and the layout worker needs a real
// `Worker`). This exercises the same effect in isolation: the contract is that
// overlay intent is dropped whenever either report identity changes, so a report
// that leaves and re-enters `READY` cannot switch the overlay back on. #1880
const useOverlayIntent = () => {
    const [isEnabled, setIsEnabled] = useState(false);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const [scope, setScope] = useState({ profiler: activeProfilerReport, performance: activePerformanceReport });
    if (scope.profiler !== activeProfilerReport || scope.performance !== activePerformanceReport) {
        setScope({ profiler: activeProfilerReport, performance: activePerformanceReport });
        setIsEnabled(false);
    }
    return [isEnabled, setIsEnabled] as const;
};

const TOGGLE_LABEL = 'toggle overlay';

// Intent is driven and read through the DOM rather than captured into module
// state, so nothing is written during render.
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
        // Either report re-anchors the ramp, so either has to reset. A perf report
        // swap is the more dangerous of the two: the graph is unchanged, so a
        // stale overlay looks plausible while encoding a different run.
        const store = renderProbe();
        enableOverlay();
        act(() => store.set(activePerformanceReportAtom, reportFolder('resnet50-perf')));

        expect(intent()).toBe('false');
    });

    it('does not re-enable itself when a report is swapped back', () => {
        // The regression this guards: binding the switch to derived active state
        // while holding intent meant a report leaving and re-entering READY turned
        // the overlay back on with no user action.
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
        // A reset that fired on every render would make the switch impossible to
        // turn on at all.
        const store = renderProbe();
        const report = reportFolder('resnet50');
        act(() => store.set(activeProfilerReportAtom, report));
        enableOverlay();
        act(() => store.set(activeProfilerReportAtom, report));

        expect(intent()).toBe('true');
    });
});
