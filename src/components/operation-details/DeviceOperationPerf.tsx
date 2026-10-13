// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment, JSX } from 'react';
import classNames from 'classnames';
import { Classes, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { ColumnDefinition, ColumnKeys, Columns } from '../../definitions/PerfTable';
import { PerfOverlayStatus } from '../../definitions/PerfOverlayStatus';
import { formatPercentage, formatSize } from '../../functions/math';
import { formatCell, getCellColour } from '../../functions/perfFunctions';
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

const SMALLEST_SHOWN_SHARE_PERCENT = 0.1;

const formatShare = (deviceTimeUs: number, totalDeviceTimeUs: number): string | null => {
    if (!Number.isFinite(deviceTimeUs) || totalDeviceTimeUs <= 0) {
        return null;
    }

    const percent = (deviceTimeUs / totalDeviceTimeUs) * 100;

    return percent > 0 && percent < SMALLEST_SHOWN_SHARE_PERCENT
        ? `<${formatPercentage(SMALLEST_SHOWN_SHARE_PERCENT, 1)}`
        : formatPercentage(percent, 1);
};

const formatCores = (cores: number | null): string | null =>
    cores !== null && Number.isFinite(cores) ? `${cores} ${cores === 1 ? 'core' : 'cores'}` : null;

const isMissing = (value: unknown): boolean => value === null || value === '' || Number.isNaN(value);

const addColumnName = (namesByReason: Map<string, string[]>, reason: string, name: string) =>
    namesByReason.set(reason, [...(namesByReason.get(reason) ?? []), name]);

// The table explains n/a and SLOW cells in hover titles, which a hover card cannot host, so they are spelled out.
const DeviceOperationPerfDetails = ({ row }: { row: TypedPerfTableRow }) => {
    const unanalysedNamesByReason = new Map<string, string[]>();
    const explainedNamesByReason = new Map<string, string[]>();
    const lines: JSX.Element[] = [];

    DETAIL_COLUMNS.forEach((column) => {
        const unanalysedReason = isMissing(row[column.key]) ? getNotAnalysedReason(row, column.key) : null;

        if (unanalysedReason) {
            addColumnName(unanalysedNamesByReason, unanalysedReason, column.name);
            return;
        }

        const cell = formatCell(row, column);

        if (cell === '') {
            return;
        }

        const explanation = getSlowBoundExplanation(row, column.key, getCellColour(row, column.key));

        if (explanation) {
            addColumnName(explainedNamesByReason, explanation, column.name);
        }

        lines.push(
            <Fragment key={column.key}>
                <span className='device-operation-perf-label'>{column.name}</span>
                <span>{cell}</span>
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

/** Device time, cores and share of the report's device time, with the whole perf row on hover. */
export const DeviceOperationPerfSummary = ({ row, totalDeviceTimeUs }: DeviceOperationPerfSummaryProps) => {
    const cores = formatCores(row.cores);
    const share = formatShare(row.device_time ?? NaN, totalDeviceTimeUs);

    return (
        <Tooltip
            content={<DeviceOperationPerfDetails row={row} />}
            position={PopoverPosition.TOP}
            className='device-operation-perf-target'
            popoverClassName='device-operation-perf-popover'
        >
            <span className={classNames('device-operation-perf', Classes.TOOLTIP_INDICATOR)}>
                {formatCell(row, DEVICE_TIME_COLUMN)}
                {cores && (
                    <>
                        <span className='separator'>·</span>
                        <span className={getCellColour(row, ColumnKeys.Cores)}>{cores}</span>
                    </>
                )}
                {share && (
                    <>
                        <span className='separator'>·</span>
                        <span>{share} of device time</span>
                    </>
                )}
            </span>
        </Tooltip>
    );
};

interface OperationDevicePerfSummaryProps {
    status: PerfOverlayStatus;
    isLoading: boolean;
    /** The operation's device operation rows, in the order they ran. */
    rows: TypedPerfTableRow[];
    totalDeviceTimeUs: number;
}

const formatDeviceTime = (deviceTimeUs: number): string => `${formatSize(deviceTimeUs, 0)} µs`;

/** One line above the device operations: their total device time and the slowest of them. */
export const OperationDevicePerfSummary = ({
    status,
    isLoading,
    rows,
    totalDeviceTimeUs,
}: OperationDevicePerfSummaryProps) => {
    if (isLoading) {
        return null;
    }

    if (status === PerfOverlayStatus.UNAVAILABLE) {
        return (
            <p className='operation-device-perf-summary is-unavailable'>
                Load a performance report from the same run to see how long each device operation took.
            </p>
        );
    }

    if (status === PerfOverlayStatus.UNLINKED) {
        return (
            <p className='operation-device-perf-summary is-unavailable'>
                The loaded performance report does not match this memory report, so device times are not shown.
            </p>
        );
    }

    if (rows.length === 0) {
        return null;
    }

    const totalUs = rows.reduce((total, row) => total + (row.device_time ?? 0), 0);
    const share = formatShare(totalUs, totalDeviceTimeUs);
    const slowest = rows.reduce((current, row) =>
        (row.device_time ?? 0) > (current.device_time ?? 0) ? row : current,
    );
    const slowestCores = formatCores(slowest.cores);

    return (
        <p className='operation-device-perf-summary'>
            {rows.length} device {rows.length === 1 ? 'operation' : 'operations'} ran for{' '}
            <strong>{formatDeviceTime(totalUs)}</strong>
            {share && ` (${share} of the report's device time)`}.
            {rows.length > 1 && (
                <>
                    {' '}
                    Slowest: <strong>{slowest.raw_op_code}</strong>, {formatDeviceTime(slowest.device_time ?? 0)}
                    {slowestCores && ` on ${slowestCores}`}.
                </>
            )}
        </p>
    );
};
