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
import { ReportLocation } from '../src/definitions/Reports';
import { Signpost } from '../src/model/Signpost';

const REPORT_NAME = '2026_08_14_10_00_00';
const INSTANCE_ID = 'instance-a';
const SIGNPOST: Signpost = { id: 42, op_code: 'BEGIN_TRACE' };

const reportKey = (
    params: PerformanceReportParams,
    instanceId = INSTANCE_ID,
    location: ReportLocation | null = ReportLocation.LOCAL,
) => getPerformanceReportQueryKey({ name: REPORT_NAME, instanceId, location, params });

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
//
// Takes no overrides deliberately. Every filter is pinned now, so an override
// could only bypass the pin under test and assert against its own value instead.
const linkedParams = (): PerformanceReportParams => getLinkedPerformanceReportParams();

describe('getPerformanceReportQueryKey', () => {
    it('names the report and every filter the backend varies rows on', () => {
        expect(reportKey(defaultViewParams)).toEqual([
            'get-performance-report',
            INSTANCE_ID,
            ReportLocation.LOCAL,
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
        const key = reportKey({ ...defaultViewParams, startSignpost: SIGNPOST });

        expect(key).toContain('startSignpost:42:BEGIN_TRACE');
    });

    it('delimits id from op code, so no two signposts can collide on one segment', () => {
        const oneThenTwoX = reportKey({ ...defaultViewParams, startSignpost: { id: 1, op_code: '2X' } });
        const twelveThenX = reportKey({ ...defaultViewParams, startSignpost: { id: 12, op_code: 'X' } });

        expect(oneThenTwoX).not.toEqual(twelveThenX);
    });

    it('matches the link key exactly while the performance tab is at its defaults', () => {
        expect(reportKey(defaultViewParams)).toEqual(reportKey(linkedParams()));
    });

    it('holds the link key still when the tab changes its stacked grouping', () => {
        // Grouping cannot change `report`, but it is part of the key — following
        // it would blank the link report on every switch.
        expect(reportKey(linkedParams())).toContain(`groupBy:${StackedGroupBy.OP}`);
    });

    // Report names are bare folder basenames, so two instances can hold different
    // reports under one name. These queries never expire and report selection does
    // not always clear the cache, so an unscoped key would hand one instance's
    // report to another.
    it('separates cache entries for the same report name in different instances', () => {
        expect(reportKey(defaultViewParams, 'instance-a')).not.toEqual(reportKey(defaultViewParams, 'instance-b'));
    });

    // `instanceId` is per browser session, so it is the same for a local and a
    // remote selection in one tab. The server resolves `?name=` against the parent
    // of the instance's `performance_path` — the uploads folder or the synced one —
    // so one basename addresses two reports, and selecting a local report does not
    // clear the cache. Without this segment the remote rows survive the switch.
    it('separates cache entries for the same report name in different locations', () => {
        expect(reportKey(defaultViewParams, INSTANCE_ID, ReportLocation.REMOTE)).not.toEqual(
            reportKey(defaultViewParams, INSTANCE_ID, ReportLocation.LOCAL),
        );
    });

    // Divergence is the cost of pinning, not a bug: each of these forks the link
    // query onto a second `perf-results/report` build for the session (#1886).
    // Tracing mode is here because the link key pins it — before #1812 was closed
    // both sides followed the atom, so a toggle moved them together.
    it.each([
        ['merge devices off', { mergeDevices: false }],
        ['host ops shown', { hideHostOps: false }],
        ['a signpost range', { startSignpost: SIGNPOST }],
        ['a different stacked grouping', { groupBy: StackedGroupBy.MEMORY }],
        ['tracing mode on', { tracingMode: true }],
    ])('diverges from the link key with %s', (_label, overrides) => {
        expect(reportKey({ ...defaultViewParams, ...overrides })).not.toEqual(reportKey(linkedParams()));
    });
});

describe('getPerformanceComparisonReportQueryKey', () => {
    const COMPARISON_NAMES = [REPORT_NAME, '2026_08_14_11_00_00'];

    const comparisonKey = (
        names: string[] | null,
        params: PerformanceReportParams,
        instanceId = INSTANCE_ID,
        location: ReportLocation | null = ReportLocation.LOCAL,
    ) => getPerformanceComparisonReportQueryKey({ names, instanceId, location, params });

    it('names the reports and carries the same filter segments as the single-report key', () => {
        expect(comparisonKey(COMPARISON_NAMES, defaultViewParams)).toEqual([
            'get-performance-comparison-report',
            INSTANCE_ID,
            ReportLocation.LOCAL,
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
        expect(comparisonKey(COMPARISON_NAMES, defaultViewParams)).not.toEqual(reportKey(defaultViewParams));
    });

    it('separates cache entries for different report selections', () => {
        expect(comparisonKey(COMPARISON_NAMES, defaultViewParams)).not.toEqual(
            comparisonKey([REPORT_NAME], defaultViewParams),
        );
    });

    it('separates cache entries for the same selection in different instances', () => {
        expect(comparisonKey(COMPARISON_NAMES, defaultViewParams, 'instance-a')).not.toEqual(
            comparisonKey(COMPARISON_NAMES, defaultViewParams, 'instance-b'),
        );
    });

    it('separates cache entries for the same selection in different locations', () => {
        expect(comparisonKey(COMPARISON_NAMES, defaultViewParams, INSTANCE_ID, ReportLocation.REMOTE)).not.toEqual(
            comparisonKey(COMPARISON_NAMES, defaultViewParams, INSTANCE_ID, ReportLocation.LOCAL),
        );
    });

    it('separates cache entries when a filter changes', () => {
        expect(comparisonKey(COMPARISON_NAMES, defaultViewParams)).not.toEqual(
            comparisonKey(COMPARISON_NAMES, { ...defaultViewParams, mergeDevices: false }),
        );
    });
});
