// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { createStore } from 'jotai';
import { activePerformanceReportAtom, filterBySignpostAtom, performanceReportLocationAtom } from '../src/store/app';
import { ReportLocation } from '../src/definitions/Reports';

const REPORT_A = { path: 'report-a', reportName: 'report-a' };
const REPORT_B = { path: 'report-b', reportName: 'report-b' };
const START = { id: 4, op_code: 'PERF_DECODE' };
const END = { id: 90, op_code: 'PERF_DECODE_END' };

const storeOn = (report: typeof REPORT_A) => {
    const store = createStore();
    store.set(activePerformanceReportAtom, report);

    return store;
};

// The API refuses a signpost the report does not hold, so a range must not follow
// the user onto another report.
describe('filterBySignpostAtom', () => {
    it('reads back the range chosen on the active report', () => {
        const store = storeOn(REPORT_A);

        store.set(filterBySignpostAtom, [START, END]);

        expect(store.get(filterBySignpostAtom)).toEqual([START, END]);
    });

    it('applies an updater to the current range', () => {
        const store = storeOn(REPORT_A);

        store.set(filterBySignpostAtom, [START, null]);
        store.set(filterBySignpostAtom, (range) => [range[0], END]);

        expect(store.get(filterBySignpostAtom)).toEqual([START, END]);
    });

    it('holds no range on another report, and restores it on switching back', () => {
        const store = storeOn(REPORT_A);
        store.set(filterBySignpostAtom, [START, END]);

        store.set(activePerformanceReportAtom, REPORT_B);
        expect(store.get(filterBySignpostAtom)).toEqual([null, null]);

        store.set(activePerformanceReportAtom, REPORT_A);
        expect(store.get(filterBySignpostAtom)).toEqual([START, END]);
    });

    it('keeps one identity for an unset range so params memoised from it stay stable', () => {
        const store = storeOn(REPORT_A);
        const unset = store.get(filterBySignpostAtom);
        store.set(filterBySignpostAtom, [START, END]);

        store.set(activePerformanceReportAtom, REPORT_B);

        expect(store.get(filterBySignpostAtom)).toBe(unset);
    });

    it('starts a range on the new report from nothing', () => {
        const store = storeOn(REPORT_A);
        store.set(filterBySignpostAtom, [START, END]);
        store.set(activePerformanceReportAtom, REPORT_B);

        store.set(filterBySignpostAtom, (range) => [range[0], END]);

        expect(store.get(filterBySignpostAtom)).toEqual([null, END]);
    });

    it("holds no range on a remote report sharing the local one's folder name", () => {
        const store = storeOn(REPORT_A);
        store.set(performanceReportLocationAtom, ReportLocation.LOCAL);
        store.set(filterBySignpostAtom, [START, END]);

        store.set(performanceReportLocationAtom, ReportLocation.REMOTE);
        expect(store.get(filterBySignpostAtom)).toEqual([null, null]);

        store.set(performanceReportLocationAtom, ReportLocation.LOCAL);
        expect(store.get(filterBySignpostAtom)).toEqual([START, END]);
    });
});
