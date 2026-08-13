// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import classNames from 'classnames';
import { ReactNode } from 'react';
import PerfChartHint from './PerfChartHint';
import { PERF_CHART_TABLE_FILTER_HINT } from '../../definitions/PerformanceCharts';
import 'styles/components/PerfChartFrame.scss';

const NO_HINTS: string[] = [];

interface PerfChartFrameProps {
    id?: string;
    className?: string;
    title: string;
    subtitle?: ReactNode;
    isClickable: boolean;
    /**
     * Guidance for in-plot controls the chart draws itself, e.g. the duration bucket buttons.
     * Plotly anchors annotation hover labels beside the annotation with no way to place them
     * above it, so per-control tooltips read poorly and the guidance lives here instead.
     */
    hints?: string[];
    children: ReactNode;
}

function PerfChartFrame({
    id,
    className,
    title,
    subtitle,
    isClickable,
    hints = NO_HINTS,
    children,
}: PerfChartFrameProps) {
    const allHints = isClickable ? [PERF_CHART_TABLE_FILTER_HINT, ...hints] : hints;

    return (
        <div
            id={id}
            className={classNames(className, {
                'perf-chart-clickable': isClickable,
            })}
        >
            <h3>{title}</h3>
            {subtitle}
            {allHints.map((hint) => (
                <PerfChartHint
                    key={hint}
                    text={hint}
                />
            ))}
            {children}
        </div>
    );
}

export default PerfChartFrame;
