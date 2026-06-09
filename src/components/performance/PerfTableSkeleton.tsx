// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Classes } from '@blueprintjs/core';
import classNames from 'classnames';
import { TEST_IDS } from '../../definitions/TestIds';

const SKELETON_ROW_COUNT = 12;

interface PerfTableSkeletonProps {
    headers: string[];
    rowCount?: number;
    hasLeadingColumn?: boolean;
}

function PerfTableSkeleton({
    headers,
    rowCount = SKELETON_ROW_COUNT,
    hasLeadingColumn = false,
}: PerfTableSkeletonProps) {
    return (
        <table
            className='perf-table monospace'
            aria-busy='true'
            aria-label='Loading performance data'
            data-testid={TEST_IDS.PERF_TABLE_SKELETON}
        >
            <thead className='table-header'>
                <tr>
                    {hasLeadingColumn && (
                        <th
                            className='cell-header'
                            aria-hidden='true'
                        />
                    )}
                    {headers.map((header) => (
                        <th
                            key={header}
                            className='cell-header'
                        >
                            <span className='header-label no-button'>{header}</span>
                        </th>
                    ))}
                </tr>
            </thead>

            <tbody>
                {Array.from({ length: rowCount }, (_, rowIndex) => (
                    <tr key={rowIndex}>
                        {hasLeadingColumn && (
                            <td className='cell'>
                                <span className={classNames('skeleton-cell', Classes.SKELETON)} />
                            </td>
                        )}
                        {headers.map((header) => (
                            <td
                                key={header}
                                className='cell'
                            >
                                <span className={classNames('skeleton-cell', Classes.SKELETON)} />
                            </td>
                        ))}
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default PerfTableSkeleton;
