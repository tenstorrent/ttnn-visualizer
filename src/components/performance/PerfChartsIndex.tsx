// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Menu, MenuItem, Popover, PopoverPosition } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import ROUTES from '../../definitions/Routes';
import { type PerfChartIndexEntry } from '../../definitions/PerformanceCharts';
import 'styles/components/PerfChartsIndex.scss';

interface PerfChartsIndexProps {
    entries: PerfChartIndexEntry[];
    activeId: string | null;
}

const DEFAULT_BUTTON_TEXT = 'Jump to chart';

function PerfChartsIndex({ entries, activeId }: PerfChartsIndexProps) {
    if (entries.length === 0) {
        return null;
    }

    const activeLabel = entries.find((entry) => entry.id === activeId)?.label ?? DEFAULT_BUTTON_TEXT;

    return (
        <div className='perf-charts-index'>
            <Popover
                position={PopoverPosition.BOTTOM_LEFT}
                minimal
                content={
                    <Menu className='perf-charts-index-menu'>
                        {entries.map((entry) => (
                            <MenuItem
                                key={entry.id}
                                text={entry.label}
                                href={`${ROUTES.PERFORMANCE}#${entry.id}`}
                                active={entry.id === activeId}
                            />
                        ))}
                    </Menu>
                }
            >
                <Button
                    className='perf-charts-index-trigger'
                    icon={IconNames.PROPERTIES}
                    endIcon={IconNames.CARET_DOWN}
                    text={<span className='perf-charts-index-trigger-label'>{activeLabel}</span>}
                />
            </Popover>
        </div>
    );
}

export default PerfChartsIndex;
