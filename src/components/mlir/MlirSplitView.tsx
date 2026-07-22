// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type PointerEvent as ReactPointerEvent, useCallback, useMemo, useRef, useState } from 'react';
import { Button, ButtonVariant, HTMLSelect, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import type { GraphBundle } from '../../model/MLIRJsonModel';
import MlGraph from './MLIRViewReactFlow';
import 'styles/components/MlirSplitView.scss';

export interface MlirSplitReport {
    key: string;
    label: string;
    data: GraphBundle;
}

interface MlirSplitViewProps {
    reports: MlirSplitReport[];
    initialLeftKey: string;
    initialRightKey: string;
    onExit: () => void;
}

const MIN_PANE_PCT = 20;
const MAX_PANE_PCT = 80;
const clampPct = (pct: number): number => Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, pct));

// Keep a pane's selected index in range: the route doesn't remount on data
// change, so a smaller re-upload could otherwise leave an index dangling past
// the new graph list and feed `undefined` into MlGraph.
const clampIndex = (index: number, count: number): number => Math.min(Math.max(index, 0), Math.max(count - 1, 0));

const getReport = (reports: MlirSplitReport[], key: string): MlirSplitReport =>
    reports.find((report) => report.key === key) ?? reports[0];

type PaneSide = 'left' | 'right';

const MlirSplitView = ({ reports, initialLeftKey, initialRightKey, onExit }: MlirSplitViewProps) => {
    const isMultiReport = reports.length > 1;
    const [leftKey, setLeftKey] = useState(initialLeftKey);
    const [rightKey, setRightKey] = useState(initialRightKey);
    const [leftGraphIndex, setLeftGraphIndex] = useState(0);
    const [rightGraphIndex, setRightGraphIndex] = useState(0);
    const [leftPct, setLeftPct] = useState(50);
    const containerRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    const leftReport = getReport(reports, leftKey);
    const rightReport = getReport(reports, rightKey);
    const safeLeftGraphIndex = clampIndex(leftGraphIndex, leftReport.data.graphs.length);
    const safeRightGraphIndex = clampIndex(rightGraphIndex, rightReport.data.graphs.length);

    // Per-pane single-graph bundles keep MlGraph unchanged (it renders graphs[0]).
    // useMemo stabilises each bundle's identity so memo(MlGraph) skips re-rendering
    // on unrelated parent updates (e.g. a divider drag); switching graphs still
    // remounts the pane via MlGraph's internal `key={graphs[0].id}`.
    const leftBundle = useMemo<GraphBundle>(
        () => ({ graphs: [leftReport.data.graphs[safeLeftGraphIndex]] }),
        [leftReport.data.graphs, safeLeftGraphIndex],
    );
    const rightBundle = useMemo<GraphBundle>(
        () => ({ graphs: [rightReport.data.graphs[safeRightGraphIndex]] }),
        [rightReport.data.graphs, safeRightGraphIndex],
    );

    const onDividerPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
    }, []);

    const onDividerPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current || !containerRef.current) {
            return;
        }
        const rect = containerRef.current.getBoundingClientRect();
        setLeftPct(clampPct(((event.clientX - rect.left) / rect.width) * 100));
    }, []);

    const onDividerPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
        draggingRef.current = false;
        // releasePointerCapture throws if this element never captured the pointer
        // (e.g. a stray pointerup or a capture that silently failed).
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const swapPanes = useCallback(() => {
        setLeftKey(rightKey);
        setRightKey(leftKey);
        setLeftGraphIndex(safeRightGraphIndex);
        setRightGraphIndex(safeLeftGraphIndex);
    }, [leftKey, rightKey, safeLeftGraphIndex, safeRightGraphIndex]);

    const handleReportChange = (side: PaneSide, nextKey: string) => {
        if (side === 'left') {
            setLeftKey(nextKey);
            setLeftGraphIndex(0);
        } else {
            setRightKey(nextKey);
            setRightGraphIndex(0);
        }
    };

    const renderHeader = (
        side: PaneSide,
        report: MlirSplitReport,
        graphIndex: number,
        setGraphIndex: (next: number) => void,
    ) => {
        // Cross-file: each pane can pick any loaded report. In-file (one report):
        // the select lists graphs inside that bundle.
        const selectOptions = isMultiReport
            ? reports.map((entry) => ({ value: entry.key, label: entry.label }))
            : report.data.graphs.map((graph, i) => ({ value: String(i), label: graph.id }));
        const selectValue = isMultiReport ? report.key : String(graphIndex);
        const selectAriaLabel = isMultiReport ? `${side} pane report` : `${side} pane graph`;

        return (
            <header className='mlir-split-pane-header'>
                <HTMLSelect
                    className='mlir-split-pane-select'
                    aria-label={selectAriaLabel}
                    value={selectValue}
                    onChange={(event) => {
                        const { value } = event.currentTarget;
                        if (isMultiReport) {
                            handleReportChange(side, value);
                        } else {
                            setGraphIndex(Number(value));
                        }
                    }}
                    options={selectOptions}
                    minimal
                />
                {isMultiReport && report.data.graphs.length > 1 ? (
                    <HTMLSelect
                        className='mlir-split-pane-select'
                        aria-label={`${side} pane graph`}
                        value={graphIndex}
                        onChange={(event) => setGraphIndex(Number(event.currentTarget.value))}
                        options={report.data.graphs.map((graph, i) => ({ value: i, label: graph.id }))}
                        minimal
                    />
                ) : null}
                <span className='mlir-split-pane-header-spacer' />
                <Tooltip
                    content='Swap the two panes'
                    compact
                >
                    <Button
                        size={Size.SMALL}
                        variant={ButtonVariant.MINIMAL}
                        icon={IconNames.SWAP_HORIZONTAL}
                        aria-label='Swap panes'
                        onClick={swapPanes}
                    />
                </Tooltip>
                <Tooltip
                    content='Close split view'
                    compact
                >
                    <Button
                        size={Size.SMALL}
                        variant={ButtonVariant.MINIMAL}
                        icon={IconNames.CROSS}
                        aria-label='Close split view'
                        onClick={onExit}
                    />
                </Tooltip>
            </header>
        );
    };

    return (
        <div
            className='mlir-split-view'
            ref={containerRef}
        >
            <section
                className='mlir-split-pane'
                style={{ flexBasis: `${leftPct}%` }}
            >
                {renderHeader('left', leftReport, safeLeftGraphIndex, setLeftGraphIndex)}
                <MlGraph
                    data={leftBundle}
                    detailsCollapsible
                />
            </section>

            <div
                className='mlir-split-divider'
                role='separator'
                aria-orientation='vertical'
                aria-label='Resize panes'
                onPointerDown={onDividerPointerDown}
                onPointerMove={onDividerPointerMove}
                onPointerUp={onDividerPointerUp}
            />

            <section className='mlir-split-pane mlir-split-pane-right'>
                {renderHeader('right', rightReport, safeRightGraphIndex, setRightGraphIndex)}
                <MlGraph
                    data={rightBundle}
                    detailsCollapsible
                />
            </section>
        </div>
    );
};

export default MlirSplitView;
