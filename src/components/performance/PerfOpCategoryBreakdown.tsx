// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo, useState } from 'react';
import { Button, ButtonVariant, Callout, Collapse, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { DEVICE_TIME_CATEGORIES, getOpCategoryBreakdown } from '../../functions/perfOpCategory';
import { formatPercentage, formatSize } from '../../functions/math';
import { TEST_IDS } from '../../definitions/TestIds';

export const OTHER_CATEGORY_EXPLANATION = 'Other is device time no tt-perf-report category explains.';
export const HOST_CATEGORY_EXPLANATION = 'Host ops are not shown: they run no device time.';
const UNCLASSIFIED_LABEL = 'Unclassified';
// Matches the table's device-time totals, so a sub-microsecond op does not read as 0 µs.
const DEVICE_TIME_DECIMALS = 2;

interface PerfOpCategoryBreakdownProps {
    rows: TypedPerfTableRow[];
}

const PerfOpCategoryBreakdown = ({ rows }: PerfOpCategoryBreakdownProps) => {
    const breakdown = useMemo(() => getOpCategoryBreakdown(rows), [rows]);
    const [isOtherOpsOpen, setIsOtherOpsOpen] = useState(false);

    if (!breakdown) {
        return null;
    }

    const { percentByCategory, unclassifiedPercent, largestOtherOps, otherOpCount, hasHostOps } = breakdown;
    const shares = [
        ...DEVICE_TIME_CATEGORIES.map((category) => ({ label: category, percent: percentByCategory[category] })),
        ...(unclassifiedPercent > 0 ? [{ label: UNCLASSIFIED_LABEL, percent: unclassifiedPercent }] : []),
    ];

    return (
        <Callout
            className='op-category-breakdown'
            icon={IconNames.PIE_CHART}
            data-testid={TEST_IDS.PERF_OP_CATEGORY_BREAKDOWN}
            compact
        >
            Device time by op category:{' '}
            {shares.map(({ label, percent }, index) => (
                <span key={label}>
                    {index > 0 && ', '}
                    {label} <strong>{formatPercentage(percent, 1)}</strong>
                </span>
            ))}
            . {OTHER_CATEGORY_EXPLANATION}
            {hasHostOps && ` ${HOST_CATEGORY_EXPLANATION}`}
            {otherOpCount > 0 && (
                <>
                    <Button
                        className='op-category-breakdown-toggle'
                        variant={ButtonVariant.MINIMAL}
                        size={Size.SMALL}
                        icon={isOtherOpsOpen ? IconNames.CARET_DOWN : IconNames.CARET_RIGHT}
                        onClick={() => setIsOtherOpsOpen((isOpen) => !isOpen)}
                        aria-expanded={isOtherOpsOpen}
                    >
                        Largest Other ops ({largestOtherOps.length} of {otherOpCount})
                    </Button>
                    <Collapse isOpen={isOtherOpsOpen}>
                        <ol className='op-category-other-ops'>
                            {largestOtherOps.map((row) => (
                                <li key={row.id}>
                                    {row.op_code}{' '}
                                    <span className='op-category-other-time'>
                                        {formatSize(row.device_time ?? 0, DEVICE_TIME_DECIMALS)} µs
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </Collapse>
                </>
            )}
        </Callout>
    );
};

export default PerfOpCategoryBreakdown;
