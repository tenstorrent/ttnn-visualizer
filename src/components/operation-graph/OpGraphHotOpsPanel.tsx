// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo, useId, useMemo } from 'react';
import { Checkbox, SegmentedControl, Size } from '@blueprintjs/core';
import classNames from 'classnames';
import { useAtom } from 'jotai';
import { DEFAULT_HOT_OPS_SETTINGS, HOT_OPS_LIMITS, HotOpsSort } from '../../definitions/HotOps';
import { NO_PERF_DATA_LABEL } from '../../definitions/PerfOverlayStatus';
import { formatDuration, formatShareOfTotal } from '../../functions/formatting';
import { isHotOpsSort } from '../../functions/hotOpsSettings';
import { hotOpsSettingsAtom } from '../../store/app';
import { type HotOpRow, getVisibleHotOpRows } from './opGraphHotOps';
import { getPerfColorForNs } from './opGraphPerfOverlay';

const ALL_LIMIT = 'all';
const NO_RANK_LABEL = '–';

const LIMIT_OPTIONS = [
    ...HOT_OPS_LIMITS.map((limit) => ({ label: `Top ${limit}`, value: String(limit) })),
    { label: 'All', value: ALL_LIMIT },
];

const SORT_OPTIONS = [
    { label: 'Slowest first', value: HotOpsSort.DURATION },
    { label: 'By ID', value: HotOpsSort.OPERATION_ID },
];

const limitFromOption = (value: string) =>
    value === ALL_LIMIT
        ? null
        : (HOT_OPS_LIMITS.find((limit) => String(limit) === value) ?? DEFAULT_HOT_OPS_SETTINGS.limit);

interface OpGraphHotOpsPanelProps {
    rows: readonly HotOpRow[];
    linkedOpCount: number;
    totalNs: number;
    /** The legend's range, so a swatch matches the bar on its node. */
    minNs: number;
    maxNs: number;
    selectedOperationId: number | null;
    onSelectOperation: (operationId: number) => void;
}

const OpGraphHotOpsPanel = ({
    rows,
    linkedOpCount,
    totalNs,
    minNs,
    maxNs,
    selectedOperationId,
    onSelectOperation,
}: OpGraphHotOpsPanelProps) => {
    const titleId = useId();
    const [settings, setSettings] = useAtom(hotOpsSettingsAtom);
    const { limit, sort, hideUnlinked } = settings;
    const visibleRows = useMemo(() => getVisibleHotOpRows(rows, settings), [rows, settings]);
    const hasUnlinked = useMemo(() => rows.some((row) => row.rank === null), [rows]);

    return (
        <section
            className='op-graph-hot-ops'
            aria-labelledby={titleId}
        >
            <header className='op-graph-hot-ops-header'>
                <h2
                    id={titleId}
                    className='op-graph-hot-ops-title'
                >
                    Slowest operations
                </h2>
                <span className='op-graph-panel-section-count'>{linkedOpCount}</span>
            </header>
            <div className='op-graph-hot-ops-controls'>
                <SegmentedControl
                    size={Size.SMALL}
                    options={LIMIT_OPTIONS}
                    value={limit === null ? ALL_LIMIT : String(limit)}
                    onValueChange={(value) => setSettings((current) => ({ ...current, limit: limitFromOption(value) }))}
                />
                <SegmentedControl
                    size={Size.SMALL}
                    options={SORT_OPTIONS}
                    value={sort}
                    onValueChange={(value) =>
                        setSettings((current) => (isHotOpsSort(value) ? { ...current, sort: value } : current))
                    }
                />
                {hasUnlinked ? (
                    <Checkbox
                        className='op-graph-hot-ops-hide-unlinked'
                        label='Hide ops without perf data'
                        checked={hideUnlinked}
                        onChange={() => setSettings((current) => ({ ...current, hideUnlinked: !current.hideUnlinked }))}
                    />
                ) : null}
            </div>
            <ol className='op-graph-hot-ops-list'>
                {visibleRows.map((row) => (
                    <li key={row.operationId}>
                        <HotOpRowButton
                            row={row}
                            totalNs={totalNs}
                            color={
                                row.deviceTimeNs === null
                                    ? undefined
                                    : getPerfColorForNs(row.deviceTimeNs, minNs, maxNs)
                            }
                            isSelected={row.operationId === selectedOperationId}
                            onSelect={onSelectOperation}
                        />
                    </li>
                ))}
            </ol>
        </section>
    );
};

interface HotOpRowButtonProps {
    row: HotOpRow;
    totalNs: number;
    color: string | undefined;
    isSelected: boolean;
    onSelect: (operationId: number) => void;
}

const HotOpRowButton = memo(({ row, totalNs, color, isSelected, onSelect }: HotOpRowButtonProps) => {
    const { operationId, name, deviceTimeNs, rank } = row;

    return (
        <button
            type='button'
            className={classNames('op-graph-hot-ops-row', { 'is-selected': isSelected })}
            aria-current={isSelected ? 'true' : undefined}
            title={`${operationId} ${name}`}
            onClick={() => onSelect(operationId)}
        >
            <span className='op-graph-hot-ops-rank'>{rank ?? NO_RANK_LABEL}</span>
            <span
                className='op-graph-hot-ops-swatch'
                style={color === undefined ? undefined : { backgroundColor: color }}
                aria-hidden='true'
            />
            <span className='op-graph-hot-ops-id'>{operationId}</span>
            <span className='op-graph-hot-ops-name'>{name}</span>
            <span className='op-graph-hot-ops-duration'>
                {deviceTimeNs === null ? NO_PERF_DATA_LABEL : formatDuration(deviceTimeNs)}
            </span>
            <span className='op-graph-hot-ops-share'>
                {deviceTimeNs === null ? '' : formatShareOfTotal(deviceTimeNs, totalNs)}
            </span>
        </button>
    );
});

HotOpRowButton.displayName = 'HotOpRowButton';

export default memo(OpGraphHotOpsPanel);
