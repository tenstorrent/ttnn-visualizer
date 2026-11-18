// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useMemo, useRef } from 'react';
import PerfChartsIndex from './PerfChartsIndex';
import { PerfChartIndexEntry } from '../../definitions/PerformanceCharts';
import { PerfChartLabel } from '../../definitions/EventLogEvent';
import { getPerfChartForChartId, recordPerfChartViewed } from '../../functions/surfaceEvents';
import { useScrollSpy } from '../../hooks/useScrollSpy';

// Clears the sticky "Jump to chart" bar. Keep in sync with $perf-charts-nav-offset (PerfCharts.scss).
export const PERF_CHARTS_NAV_OFFSET_PX = 60;

interface PerfChartsNavigationProps {
    entries: PerfChartIndexEntry[];
}

/**
 * The "Jump to chart" index and the `perf_chart_viewed` recording that follows the same scroll
 * position. Kept apart from the charts so that a scroll re-renders this alone, not every chart.
 */
function PerfChartsNavigation({ entries }: PerfChartsNavigationProps) {
    const chartIds = useMemo(() => entries.map((entry) => entry.id), [entries]);
    const { activeId, sectionsInView } = useScrollSpy(chartIds, PERF_CHARTS_NAV_OFFSET_PX);

    // Once per chart per mount, and this mounts only while the Charts tab is the selected one,
    // so a count means the chart was in view on a visit to the tab. The first chart counts on
    // arrival at the top: it is what the tab opens on. At the bottom of the page every chart
    // whose top is in view counts too, since on a tall screen the charts before the last never
    // reach the offset line, and a jump to one of them lands at the bottom.
    const recordedChartsRef = useRef<Set<PerfChartLabel>>(new Set());

    useEffect(() => {
        sectionsInView.forEach((chartId) => {
            const chart = getPerfChartForChartId(chartId);

            if (chart && !recordedChartsRef.current.has(chart)) {
                recordedChartsRef.current.add(chart);
                recordPerfChartViewed(chart);
            }
        });
    }, [sectionsInView]);

    return (
        <PerfChartsIndex
            entries={entries}
            activeId={activeId}
        />
    );
}

export default PerfChartsNavigation;
