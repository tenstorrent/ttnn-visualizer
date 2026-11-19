// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Fragment, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import classNames from 'classnames';
import { Button, ButtonVariant, Classes, PopoverPosition, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtomValue } from 'jotai';
import ROUTES from '../../definitions/Routes';
import { StackTraceLanguage } from '../../definitions/StackTrace';
import { TEST_IDS } from '../../definitions/TestIds';
import { formatPercentage, formatSize } from '../../functions/math';
import { SourceLineGroup, SourceLineGroupKind, getSourceLineGroupLabel } from '../../functions/perfSourceLines';
import useSortTable from '../../hooks/useSortTable';
import { Operation } from '../../model/APIData';
import { mergeDevicesAtom } from '../../store/app';
import HighlightedText from '../HighlightedText';
import SourceFileButton from '../operation-details/SourceFileButton';
import PerfDeviceArchitecture from './PerfDeviceArchitecture';
import PerfMultiDeviceNotice from './PerfMultiDeviceNotice';
import PerfTableFrame from './PerfTableFrame';
import PerfTableSkeleton from './PerfTableSkeleton';
import SortableHeaderLabel from './SortableHeaderLabel';
import 'styles/components/PerfReport.scss';

enum SourceLineColumnKey {
    PERCENT = 'percent',
    LOCATION = 'location',
    DEVICE = 'device',
    DEVICE_TIME = 'deviceTimeUs',
    ROW_COUNT = 'rowCount',
    TOP_OP_CODES = 'topOpCodes',
    SOURCE = 'source',
}

interface SourceLineColumn {
    key: SourceLineColumnKey;
    label: string;
    sortable: boolean;
}

const COLUMNS: SourceLineColumn[] = [
    { key: SourceLineColumnKey.PERCENT, label: 'Total %', sortable: true },
    { key: SourceLineColumnKey.LOCATION, label: 'Source line', sortable: true },
    { key: SourceLineColumnKey.DEVICE, label: 'Device', sortable: true },
    { key: SourceLineColumnKey.DEVICE_TIME, label: 'Device Time', sortable: true },
    { key: SourceLineColumnKey.ROW_COUNT, label: 'Ops Count', sortable: true },
    { key: SourceLineColumnKey.TOP_OP_CODES, label: 'Top Op Codes', sortable: false },
    { key: SourceLineColumnKey.SOURCE, label: '', sortable: false },
];

const MERGED_COLUMNS = COLUMNS.filter((column) => column.key !== SourceLineColumnKey.DEVICE);

const PERCENT_DECIMALS = 2;
const DEVICE_TIME_DECIMALS = 2;
// A line inside a loop can link thousands of operations; past this many, the rest are counted.
export const MAX_LISTED_OPERATIONS = 100;
const EMPTY_MESSAGE = 'No data to display';

// `sortTableFields` takes flat records, so groups are sorted through this projection.
// Sorted by basename, then line number, then full path. `sortTableFields` compares strings by
// code unit, so the NUL separator sorts a shorter basename first and the zero-padded line
// number sorts `:9` before `:10`, which comparing the `basename:line` label would not.
const LOCATION_SORT_SEPARATOR = '\u0000';
const LINE_NUMBER_SORT_WIDTH = 10;

const getLocationSortValue = (group: SourceLineGroup): string =>
    group.basename === null
        ? getSourceLineGroupLabel(group)
        : [
              group.basename,
              String(group.lineNumber ?? 0).padStart(LINE_NUMBER_SORT_WIDTH, '0'),
              group.filePath ?? '',
          ].join(LOCATION_SORT_SEPARATOR);

type SourceLineSortRow = Record<SourceLineColumnKey, string | number | null> & { key: string };

const toSortRow = (group: SourceLineGroup): SourceLineSortRow => ({
    key: group.key,
    [SourceLineColumnKey.PERCENT]: group.percent,
    [SourceLineColumnKey.LOCATION]: getLocationSortValue(group),
    [SourceLineColumnKey.DEVICE]: group.device,
    [SourceLineColumnKey.DEVICE_TIME]: group.deviceTimeUs,
    [SourceLineColumnKey.ROW_COUNT]: group.rowCount,
    [SourceLineColumnKey.TOP_OP_CODES]: null,
    [SourceLineColumnKey.SOURCE]: null,
});

interface SourceLinePerfTableProps {
    groups: SourceLineGroup[];
    operationById: ReadonlyMap<number, Pick<Operation, 'name'>>;
    filterQuery: string;
    /** On-disk folder of the report these rows came from; addresses the device-meta fetch. */
    reportFolderName: string | null;
    maxCores: number;
    isLoading?: boolean;
    /** Shown in place of the generic empty message when there is a reason the table is empty. */
    emptyReason?: string | null;
    /** Device time of every line before filtering; the footer's Total % is the visible lines' share of it. */
    totalDeviceTimeUs: number;
}

const SourceLinePerfTable = ({
    groups,
    operationById,
    filterQuery,
    reportFolderName,
    maxCores,
    isLoading = false,
    emptyReason = null,
    totalDeviceTimeUs,
}: SourceLinePerfTableProps) => {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(null);
    const mergeDevices = useAtomValue(mergeDevicesAtom);
    const [expandedKeys, setExpandedKeys] = useState<ReadonlySet<string>>(() => new Set());
    const columns = mergeDevices ? MERGED_COLUMNS : COLUMNS;

    const groupByKey = useMemo(() => new Map(groups.map((group) => [group.key, group])), [groups]);
    const sortedGroups = useMemo(
        () =>
            sortTableFields(groups.map(toSortRow)).flatMap((row) => {
                const group = groupByKey.get(row.key);
                return group ? [group] : [];
            }),
        [groups, groupByKey, sortTableFields],
    );
    const footerTotals = useMemo(() => {
        const deviceTimeUs = groups.reduce((total, group) => total + group.deviceTimeUs, 0);

        return {
            // The visible lines' share of all the range's device time: 100% unfiltered, less under a
            // filter. Not a sum of the lines' own percentages, which are per device while devices
            // are unmerged and would sum to 100 per device.
            percent: totalDeviceTimeUs > 0 ? (deviceTimeUs / totalDeviceTimeUs) * 100 : 0,
            deviceTimeUs,
            rowCount: groups.reduce((total, group) => total + group.rowCount, 0),
        };
    }, [groups, totalDeviceTimeUs]);

    const toggleExpanded = useCallback((key: string) => {
        setExpandedKeys((current) => {
            const next = new Set(current);

            if (!next.delete(key)) {
                next.add(key);
            }

            return next;
        });
    }, []);

    const renderCell = (group: SourceLineGroup, column: SourceLineColumn) => {
        switch (column.key) {
            case SourceLineColumnKey.PERCENT:
                return formatPercentage(group.percent, PERCENT_DECIMALS);
            case SourceLineColumnKey.LOCATION:
                return (
                    <SourceLineLocation
                        group={group}
                        filterQuery={filterQuery}
                        isExpanded={expandedKeys.has(group.key)}
                        onToggle={toggleExpanded}
                    />
                );
            case SourceLineColumnKey.DEVICE:
                return group.device ?? '';
            case SourceLineColumnKey.DEVICE_TIME:
                return `${formatSize(group.deviceTimeUs, DEVICE_TIME_DECIMALS)} µs`;
            case SourceLineColumnKey.ROW_COUNT:
                return group.rowCount;
            case SourceLineColumnKey.TOP_OP_CODES:
                return group.topOpCodes.join(', ');
            case SourceLineColumnKey.SOURCE:
                return group.kind === SourceLineGroupKind.LINE && group.filePath ? (
                    // Not `eagerProbe`: one probe per row on render would be a request per line.
                    <SourceFileButton
                        filePath={group.filePath}
                        sourceFileId={group.sourceFileId}
                        lineNumber={group.lineNumber}
                        language={StackTraceLanguage.PYTHON}
                        size={Size.SMALL}
                        variant={ButtonVariant.OUTLINED}
                        ariaLabel={`View source for ${getSourceLineGroupLabel(group)}`}
                    />
                ) : null;
            default:
                return null;
        }
    };

    const renderTable = () => {
        if (isLoading) {
            return <PerfTableSkeleton headers={columns.map((column) => column.label)} />;
        }

        if (!groups.length) {
            return (
                <p>
                    <em>{emptyReason ?? EMPTY_MESSAGE}</em>
                </p>
            );
        }

        return (
            <PerfTableFrame
                // The sorted list, so a header click scrolls back to the top as filtering does.
                scrollResetKey={sortedGroups}
                data-testid={TEST_IDS.PERF_SOURCE_LINE_TABLE}
            >
                <thead className='table-header'>
                    <tr>
                        {columns.map((column) => (
                            <th
                                key={column.key}
                                className='cell-header'
                            >
                                <SortableHeaderLabel
                                    columnKey={column.key}
                                    label={column.label}
                                    sortable={column.sortable}
                                    sortingColumn={sortingColumn}
                                    sortDirection={sortDirection}
                                    onSort={changeSorting}
                                />
                            </th>
                        ))}
                    </tr>
                </thead>

                <tbody>
                    {sortedGroups.map((group) => (
                        <Fragment key={group.key}>
                            <tr data-testid={TEST_IDS.PERF_SOURCE_LINE_ROW}>
                                {columns.map((column) => (
                                    <td
                                        key={column.key}
                                        className='cell'
                                    >
                                        {renderCell(group, column)}
                                    </td>
                                ))}
                            </tr>

                            {expandedKeys.has(group.key) && (
                                <tr className='source-line-operations'>
                                    <td
                                        className='cell'
                                        colSpan={columns.length}
                                    >
                                        <SourceLineOperations
                                            operationIds={group.operationIds}
                                            operationById={operationById}
                                        />
                                    </td>
                                </tr>
                            )}
                        </Fragment>
                    ))}
                </tbody>

                <tfoot className='table-footer'>
                    <tr>
                        {columns.map((column) => (
                            <td key={`footer-${column.key}`}>{getFooterCell(column.key, groups, footerTotals)}</td>
                        ))}
                    </tr>
                </tfoot>
            </PerfTableFrame>
        );
    };

    return (
        <>
            <PerfDeviceArchitecture
                reportFolderName={reportFolderName}
                maxCores={maxCores}
            />

            {mergeDevices && <PerfMultiDeviceNotice />}

            {renderTable()}
        </>
    );
};

const getFooterCell = (
    key: SourceLineColumnKey,
    groups: SourceLineGroup[],
    totals: { percent: number; deviceTimeUs: number; rowCount: number },
): string => {
    switch (key) {
        case SourceLineColumnKey.PERCENT:
            return formatPercentage(totals.percent, PERCENT_DECIMALS);
        case SourceLineColumnKey.LOCATION:
            return `${groups.length} source lines`;
        case SourceLineColumnKey.DEVICE_TIME:
            return `${formatSize(totals.deviceTimeUs, DEVICE_TIME_DECIMALS)} µs`;
        case SourceLineColumnKey.ROW_COUNT:
            return `${totals.rowCount}`;
        default:
            return '';
    }
};

interface SourceLineLocationProps {
    group: SourceLineGroup;
    filterQuery: string;
    isExpanded: boolean;
    onToggle: (key: string) => void;
}

const SourceLineLocation = ({ group, filterQuery, isExpanded, onToggle }: SourceLineLocationProps) => {
    const label = getSourceLineGroupLabel(group);
    const hasOperations = group.operationIds.length > 0;

    return (
        <span className='source-line-location'>
            <Button
                icon={isExpanded ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_RIGHT}
                variant={ButtonVariant.MINIMAL}
                size={Size.SMALL}
                onClick={() => onToggle(group.key)}
                disabled={!hasOperations}
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Hide' : 'Show'} operations for ${label}`}
            />

            {group.filePath ? (
                <Tooltip
                    content={group.filePath}
                    position={PopoverPosition.TOP}
                >
                    <HighlightedText
                        text={label}
                        filter={filterQuery}
                    />
                </Tooltip>
            ) : (
                <HighlightedText
                    className={Classes.TEXT_MUTED}
                    text={label}
                    filter={filterQuery}
                />
            )}

            {group.functionName && (
                <HighlightedText
                    className={classNames('source-line-function', Classes.TEXT_MUTED)}
                    text={group.functionName}
                    filter={filterQuery}
                />
            )}
        </span>
    );
};

interface SourceLineOperationsProps {
    operationIds: number[];
    operationById: ReadonlyMap<number, Pick<Operation, 'name'>>;
}

const SourceLineOperations = ({ operationIds, operationById }: SourceLineOperationsProps) => {
    const hiddenCount = operationIds.length - MAX_LISTED_OPERATIONS;

    return (
        <ul
            className='source-line-operation-list'
            data-testid={TEST_IDS.PERF_SOURCE_LINE_OPERATIONS}
        >
            {operationIds.slice(0, MAX_LISTED_OPERATIONS).map((id) => (
                <li key={id}>
                    <Link to={`${ROUTES.OPERATIONS}/${id}`}>
                        {id} {operationById.get(id)?.name ?? ''}
                    </Link>
                </li>
            ))}
            {hiddenCount > 0 && <li className={Classes.TEXT_MUTED}>and {hiddenCount} more</li>}
        </ul>
    );
};

export default SourceLinePerfTable;
