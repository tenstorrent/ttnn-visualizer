// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The link-resolution fetch pins the view filters (#1812). Pinning them to the
 * performance tab's own defaults is what keeps the two queries sharing a single
 * cache entry — and a single backend request — in the common case, so the key
 * builder is where that invariant is worth holding still.
 */

import { describe, expect, it } from 'vitest';
import {
    PerformanceReportParams,
    getLinkedPerformanceReportParams,
    getPerformanceComparisonReportQueryKey,
    getPerformanceReportQueryKey,
} from '../src/functions/performanceReportQueryKey';
import { StackedGroupBy } from '../src/definitions/StackedPerfTable';
import { Signpost } from '../src/model/Signpost';

const REPORT_NAME = '2026_08_14_10_00_00';
const SIGNPOST: Signpost = { id: 42, op_code: 'BEGIN_TRACE' };

const defaultViewParams: PerformanceReportParams = {
    startSignpost: null,
    endSignpost: null,
    hideHostOps: true,
    mergeDevices: true,
    tracingMode: false,
    groupBy: StackedGroupBy.OP,
};

// Composed through the same function the hook uses, not by spreading the pinned
// filters here — a local copy of that composition would let these key-equality
// assertions keep passing after the hook changed which filters it pins.
const linkedParams = (overrides: Partial<PerformanceReportParams> = {}): PerformanceReportParams => ({
    ...getLinkedPerformanceReportParams(false),
    ...overrides,
});

describe('getPerformanceReportQueryKey', () => {
    it('names the report and every filter the backend varies rows on', () => {
        expect(getPerformanceReportQueryKey(REPORT_NAME, defaultViewParams)).toEqual([
            'get-performance-report',
            REPORT_NAME,
            'startSignpost:null',
            'endSignpost:null',
            'hideHostOps:true',
            'mergeDevices:true',
            'tracingMode:false',
            'groupBy:operation',
        ]);
    });

    it('identifies a signpost by id and op code, so two with the same name stay distinct', () => {
        const key = getPerformanceReportQueryKey(REPORT_NAME, {
            ...defaultViewParams,
            startSignpost: SIGNPOST,
        });

        expect(key).toContain('startSignpost:42:BEGIN_TRACE');
    });

    it('delimits id from op code, so no two signposts can collide on one segment', () => {
        const oneThenTwoX = getPerformanceReportQueryKey(REPORT_NAME, {
            ...defaultViewParams,
            startSignpost: { id: 1, op_code: '2X' },
        });
        const twelveThenX = getPerformanceReportQueryKey(REPORT_NAME, {
            ...defaultViewParams,
            startSignpost: { id: 12, op_code: 'X' },
        });

        expect(oneThenTwoX).not.toEqual(twelveThenX);
    });

    it('matches the link key exactly while the performance tab is at its defaults', () => {
        expect(getPerformanceReportQueryKey(REPORT_NAME, defaultViewParams)).toEqual(
            getPerformanceReportQueryKey(REPORT_NAME, linkedParams()),
        );
    });

    // Documents the residual #1812 gap rather than a fix: tracing mode is the one
    // named filter still followed, so it can still move link status. See the note on
    // the matching case in `useLinkedPerformanceReport.spec.tsx`.
    it('keeps sharing the link key when only tracing mode changes', () => {
        const params = { tracingMode: true };

        expect(getPerformanceReportQueryKey(REPORT_NAME, { ...defaultViewParams, ...params })).toEqual(
            getPerformanceReportQueryKey(REPORT_NAME, linkedParams(params)),
        );
    });

    it('holds the link key still when the tab changes its stacked grouping', () => {
        // Grouping cannot change `report`, but it is part of the key — following
        // it would blank the link report on every switch.
        expect(getPerformanceReportQueryKey(REPORT_NAME, linkedParams())).toContain(`groupBy:${StackedGroupBy.OP}`);
    });

    it.each([
        ['merge devices off', { mergeDevices: false }],
        ['host ops shown', { hideHostOps: false }],
        ['a signpost range', { startSignpost: SIGNPOST }],
        ['a different stacked grouping', { groupBy: StackedGroupBy.MEMORY }],
    ])('diverges from the link key with %s', (_label, overrides) => {
        expect(getPerformanceReportQueryKey(REPORT_NAME, { ...defaultViewParams, ...overrides })).not.toEqual(
            getPerformanceReportQueryKey(REPORT_NAME, linkedParams()),
        );
    });
});

describe('getPerformanceComparisonReportQueryKey', () => {
    const COMPARISON_NAMES = [REPORT_NAME, '2026_08_14_11_00_00'];

    it('names the reports and carries the same filter segments as the single-report key', () => {
        expect(getPerformanceComparisonReportQueryKey(COMPARISON_NAMES, defaultViewParams)).toEqual([
            'get-performance-comparison-report',
            COMPARISON_NAMES,
            'startSignpost:null',
            'endSignpost:null',
            'hideHostOps:true',
            'mergeDevices:true',
            'tracingMode:false',
            'groupBy:operation',
        ]);
    });

    it('never collides with the single-report key for the same filters', () => {
        expect(getPerformanceComparisonReportQueryKey(COMPARISON_NAMES, defaultViewParams)).not.toEqual(
            getPerformanceReportQueryKey(REPORT_NAME, defaultViewParams),
        );
    });

    it('separates cache entries for different report selections', () => {
        expect(getPerformanceComparisonReportQueryKey(COMPARISON_NAMES, defaultViewParams)).not.toEqual(
            getPerformanceComparisonReportQueryKey([REPORT_NAME], defaultViewParams),
        );
    });

    it('separates cache entries when a filter changes', () => {
        expect(getPerformanceComparisonReportQueryKey(COMPARISON_NAMES, defaultViewParams)).not.toEqual(
            getPerformanceComparisonReportQueryKey(COMPARISON_NAMES, {
                ...defaultViewParams,
                mergeDevices: false,
            }),
        );
    });
});
