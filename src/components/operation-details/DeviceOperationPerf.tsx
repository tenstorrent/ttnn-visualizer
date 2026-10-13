// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment, JSX, ReactNode } from 'react';
import classNames from 'classnames';
import { Classes, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { ColumnDefinition, ColumnKeys, Columns } from '../../definitions/PerfTable';
import { ReportLinkMatchResult } from '../../definitions/ReportLinks';
import { isCountableDeviceTime } from '../../functions/durationBuckets';
import { formatNonZeroShareOfTotal, getCoreCountText } from '../../functions/formatting';
import { formatSize } from '../../functions/math';
import { formatCell, formatCellText, getCellColour, isHostOp } from '../../functions/perfFunctions';
import { NOT_ANALYSED_LABEL, getNotAnalysedReason, getSlowBoundExplanation } from '../../functions/perfBoundAnalysis';
import { TypedPerfTableRow } from '../../model/PerfTable';
import 'styles/components/DeviceOperationPerf.scss';

const getColumns = (keys: ColumnKeys[]): ColumnDefinition[] =>
    keys.flatMap((key) => Columns.filter((column) => column.key === key));

// The perf table's own columns, so a value reads the same here as in the table.
const [DEVICE_TIME_COLUMN] = getColumns([ColumnKeys.DeviceTime]);

const DETAIL_COLUMNS = getColumns([
    ColumnKeys.DeviceTime,
    ColumnKeys.Cores,
    ColumnKeys.OpToOpGap,
    ColumnKeys.TotalPercent,
    ColumnKeys.OpCategory,
    ColumnKeys.Bound,
    ColumnKeys.Dram,
    ColumnKeys.DramPercent,
    ColumnKeys.Flops,
    ColumnKeys.FlopsPercent,
    ColumnKeys.MathFidelity,
    ColumnKeys.DeviceKernelDuration,
]);

const LINK_STATUS_MESSAGE: Partial<Record<ReportLinkMatchResult, string>> = {
    [ReportLinkMatchResult.UNAVAILABLE]:
        'Load a performance report from the same run to see how long each device operation took.',
    [ReportLinkMatchResult.UNLINKED]:
        'The loaded performance report does not match this memory report, so device times are not shown.',
};

const formatShare = (deviceTimeUs: number | null, totalDeviceTimeUs: number): string | null =>
    isCountableDeviceTime(deviceTimeUs) && totalDeviceTimeUs > 0
        ? formatNonZeroShareOfTotal(deviceTimeUs, totalDeviceTimeUs)
        : null;

const formatCores = (cores: number | null): string | null =>
    cores !== null && Number.isFinite(cores) ? getCoreCountText(cores) : null;

const deviceTimeOf = (row: TypedPerfTableRow): number => (isCountableDeviceTime(row.device_time) ? row.device_time : 0);

const addColumnName = (namesByReason: Map<string, string[]>, reason: string, name: string) =>
    namesByReason.set(reason, [...(namesByReason.get(reason) ?? []), name]);

interface DeviceOperationPerfDetailsProps {
    row: TypedPerfTableRow;
}

// The table explains n/a and SLOW cells in hover titles, which a hover card cannot host, so they are spelled out.
const DeviceOperationPerfDetails = ({ row }: DeviceOperationPerfDetailsProps) => {
    const unanalysedNamesByReason = new Map<string, string[]>();
    const explainedNamesByReason = new Map<string, string[]>();
    const lines: JSX.Element[] = [];

    DETAIL_COLUMNS.forEach((column) => {
        const text = formatCellText(row, column);

        if (text === '') {
            const reason = isHostOp(row.bound) ? null : getNotAnalysedReason(row, column.key);

            if (reason) {
                addColumnName(unanalysedNamesByReason, reason, column.name);
            }

            return;
        }

        const explanation = getSlowBoundExplanation(row, column.key, getCellColour(row, column.key));

        if (explanation) {
            addColumnName(explainedNamesByReason, explanation, column.name);
        }

        lines.push(
            <Fragment key={column.key}>
                <span className='device-operation-perf-label'>{column.name}</span>
                <span>{text}</span>
            </Fragment>,
        );
    });

    return (
        <div className='device-operation-perf-details'>
            <div className='device-operation-perf-heading'>Performance report row {row.id}</div>
            <div className='device-operation-perf-grid'>{lines}</div>
            {[...explainedNamesByReason].map(([reason, names]) => (
                <p
                    key={reason}
                    className='device-operation-perf-note'
                >
                    {names.join(', ')}: {reason}
                </p>
            ))}
            {[...unanalysedNamesByReason].map(([reason, names]) => (
                <p
                    key={reason}
                    className='device-operation-perf-note'
                >
                    {names.join(', ')}: {NOT_ANALYSED_LABEL}. {reason}
                </p>
            ))}
        </div>
    );
};

interface DeviceOperationPerfSummaryProps {
    row: TypedPerfTableRow;
    totalDeviceTimeUs: number;
}

/** Device time, cores and share of the report's device time, with the row's key columns on hover. */
export const DeviceOperationPerfSummary = ({ row, totalDeviceTimeUs }: DeviceOperationPerfSummaryProps) => {
    const deviceTime = formatCell(row, DEVICE_TIME_COLUMN);
    const cores = formatCores(row.cores);
    const share = formatShare(row.device_time, totalDeviceTimeUs);
    const parts: { key: string; node: ReactNode }[] = [];

    if (deviceTime) {
        parts.push({ key: 'time', node: deviceTime });
    }

    if (cores) {
        parts.push({ key: 'cores', node: <span className={getCellColour(row, ColumnKeys.Cores)}>{cores}</span> });
    }

    if (share) {
        parts.push({ key: 'share', node: <span>{share} of device time</span> });
    }

    if (parts.length === 0) {
        return null;
    }

    return (
        <Tooltip
            content={<DeviceOperationPerfDetails row={row} />}
            position={PopoverPosition.TOP}
            className='device-operation-perf-target'
            popoverClassName='device-operation-perf-popover'
        >
            <span className={classNames('device-operation-perf', Classes.TOOLTIP_INDICATOR)}>
                {parts.map(({ key, node }, index) => (
                    <Fragment key={key}>
                        {index > 0 && <span className='separator'>·</span>}
                        {node}
                    </Fragment>
                ))}
            </span>
        </Tooltip>
    );
};

interface OperationDevicePerfSummaryProps {
    linkStatus: ReportLinkMatchResult;
    /** Without a device operation there is nothing to time, so not even the empty states apply. */
    hasDeviceOperations: boolean;
    rows: TypedPerfTableRow[];
    totalDeviceTimeUs: number;
}

const formatDeviceTime = (deviceTimeUs: number): string => `${formatSize(deviceTimeUs, 0)} µs`;

/** One line above the device operations: their total device time and the slowest of them. */
export const OperationDevicePerfSummary = ({
    linkStatus,
    hasDeviceOperations,
    rows,
    totalDeviceTimeUs,
}: OperationDevicePerfSummaryProps) => {
    if (!hasDeviceOperations) {
        return null;
    }

    const message = LINK_STATUS_MESSAGE[linkStatus];

    if (message) {
        return <p className='operation-device-perf-summary is-unavailable'>{message}</p>;
    }

    // tt-perf-report blanks the device time it judges invalid; such a row is neither counted nor named.
    const timedRows = rows.filter((row) => isCountableDeviceTime(row.device_time));

    if (timedRows.length === 0) {
        return null;
    }

    const totalUs = timedRows.reduce((total, row) => total + deviceTimeOf(row), 0);
    const share = formatShare(totalUs, totalDeviceTimeUs);
    const slowest = timedRows.reduce((current, row) => (deviceTimeOf(row) > deviceTimeOf(current) ? row : current));
    const slowestCores = formatCores(slowest.cores);

    return (
        <p className='operation-device-perf-summary'>
            {timedRows.length} device {timedRows.length === 1 ? 'operation' : 'operations'} ran for{' '}
            <strong>{formatDeviceTime(totalUs)}</strong>
            {share && ` (${share} of the report's device time)`}.
            {timedRows.length > 1 && (
                <>
                    {' '}
                    Slowest: <strong>{slowest.raw_op_code}</strong>, {formatDeviceTime(deviceTimeOf(slowest))}
                    {slowestCores && ` on ${slowestCores}`}.
                </>
            )}
        </p>
    );
};
