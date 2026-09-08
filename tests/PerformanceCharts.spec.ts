// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    CONV_CHART_ENTRIES,
    FILTERABLE_CHART_ENTRIES,
    MATMUL_CHART_ENTRIES,
    PerfChartGroup,
} from '../src/definitions/PerformanceCharts';
import {
    buildChartIndexEntries,
    getOperationTypesChartId,
    getOperationTypesChartLabel,
} from '../src/functions/buildChartIndexEntries';

const idsOf = (entries: { id: string }[]): string[] => entries.map((entry) => entry.id);

const FILTERABLE_IDS = idsOf(FILTERABLE_CHART_ENTRIES);
const MATMUL_IDS = idsOf(MATMUL_CHART_ENTRIES);
const CONV_IDS = idsOf(CONV_CHART_ENTRIES);

describe('buildChartIndexEntries', () => {
    it('returns only the filterable charts when there is no matmul/conv data and no report', () => {
        const entries = buildChartIndexEntries({
            hasMatmulData: false,
            hasConvData: false,
            activeReportName: null,
            comparisonReportNames: null,
        });

        expect(idsOf(entries)).toEqual(FILTERABLE_IDS);
    });

    it('appends matmul then conv groups in order, only when each has data', () => {
        expect(
            idsOf(
                buildChartIndexEntries({
                    hasMatmulData: true,
                    hasConvData: false,
                    activeReportName: null,
                    comparisonReportNames: null,
                }),
            ),
        ).toEqual([...FILTERABLE_IDS, ...MATMUL_IDS]);

        expect(
            idsOf(
                buildChartIndexEntries({
                    hasMatmulData: false,
                    hasConvData: true,
                    activeReportName: null,
                    comparisonReportNames: null,
                }),
            ),
        ).toEqual([...FILTERABLE_IDS, ...CONV_IDS]);

        expect(
            idsOf(
                buildChartIndexEntries({
                    hasMatmulData: true,
                    hasConvData: true,
                    activeReportName: null,
                    comparisonReportNames: null,
                }),
            ),
        ).toEqual([...FILTERABLE_IDS, ...MATMUL_IDS, ...CONV_IDS]);
    });

    it('adds a single Operation Types entry without a report name when there is no comparison', () => {
        const entries = buildChartIndexEntries({
            hasMatmulData: false,
            hasConvData: false,
            activeReportName: 'report-a',
            comparisonReportNames: null,
        });

        expect(entries).toContainEqual({
            id: getOperationTypesChartId('active'),
            label: getOperationTypesChartLabel(''),
            group: PerfChartGroup.ALL,
        });
        // Exactly one Operation Types entry (the active one), no comparison entries.
        expect(entries.filter((entry) => entry.id.includes('operation-types'))).toHaveLength(1);
    });

    it('labels the active and comparison Operation Types entries with report names while comparing', () => {
        const entries = buildChartIndexEntries({
            hasMatmulData: false,
            hasConvData: false,
            activeReportName: 'report-a',
            comparisonReportNames: ['report-b', 'report-c'],
        });

        expect(entries).toContainEqual({
            id: getOperationTypesChartId('active'),
            label: getOperationTypesChartLabel('report-a'),
            group: PerfChartGroup.ALL,
        });
        expect(entries).toContainEqual({
            id: getOperationTypesChartId('comparison-0'),
            label: getOperationTypesChartLabel('report-b'),
            group: PerfChartGroup.ALL,
        });
        expect(entries).toContainEqual({
            id: getOperationTypesChartId('comparison-1'),
            label: getOperationTypesChartLabel('report-c'),
            group: PerfChartGroup.ALL,
        });
    });

    it('omits the active entry and drops comparison report names when there is no active report', () => {
        const entries = buildChartIndexEntries({
            hasMatmulData: false,
            hasConvData: false,
            activeReportName: null,
            comparisonReportNames: ['report-b'],
        });

        expect(entries.find((entry) => entry.id === getOperationTypesChartId('active'))).toBeUndefined();
        expect(entries).toContainEqual({
            id: getOperationTypesChartId('comparison-0'),
            label: getOperationTypesChartLabel(''),
            group: PerfChartGroup.ALL,
        });
    });

    it('assigns every entry to its chart group', () => {
        const entries = buildChartIndexEntries({
            hasMatmulData: true,
            hasConvData: true,
            activeReportName: 'report-a',
            comparisonReportNames: null,
        });

        const groupsById = new Map(entries.map((entry) => [entry.id, entry.group]));

        FILTERABLE_IDS.forEach((id) => expect(groupsById.get(id)).toBe(PerfChartGroup.ALL));
        MATMUL_IDS.forEach((id) => expect(groupsById.get(id)).toBe(PerfChartGroup.MATMUL));
        CONV_IDS.forEach((id) => expect(groupsById.get(id)).toBe(PerfChartGroup.CONV));
        expect(groupsById.get(getOperationTypesChartId('active'))).toBe(PerfChartGroup.ALL);
    });

    it('orders the Operation Types entries with the all-operations charts, ahead of matmul and conv', () => {
        const entries = buildChartIndexEntries({
            hasMatmulData: true,
            hasConvData: true,
            activeReportName: 'report-a',
            comparisonReportNames: ['report-b'],
        });

        expect(idsOf(entries)).toEqual([
            ...FILTERABLE_IDS,
            getOperationTypesChartId('active'),
            getOperationTypesChartId('comparison-0'),
            ...MATMUL_IDS,
            ...CONV_IDS,
        ]);
    });
});
