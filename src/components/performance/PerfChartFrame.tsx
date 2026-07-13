// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import classNames from 'classnames';
import { ReactNode } from 'react';
import PerfChartFilterHint from './PerfChartFilterHint';
import 'styles/components/PerfChartFrame.scss';

interface PerfChartFrameProps {
    id?: string;
    className?: string;
    title: string;
    subtitle?: ReactNode;
    isClickable: boolean;
    children: ReactNode;
}

function PerfChartFrame({ id, className, title, subtitle, isClickable, children }: PerfChartFrameProps) {
    return (
        <div
            id={id}
            className={classNames(className, {
                'perf-chart-clickable': isClickable,
            })}
        >
            <h3>{title}</h3>
            {subtitle}
            <PerfChartFilterHint isVisible={isClickable} />
            {children}
        </div>
    );
}

export default PerfChartFrame;
