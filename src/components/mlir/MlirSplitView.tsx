// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type PointerEvent as ReactPointerEvent, useCallback, useMemo, useRef, useState } from 'react';
import { Button, ButtonVariant, HTMLSelect, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import type { GraphBundle } from '../../model/MLIRJsonModel';
import MlGraph from './MLIRViewReactFlow';
import 'styles/components/MlirSplitView.scss';

interface MlirSplitViewProps {
    leftData: GraphBundle;
    rightData: GraphBundle;
    leftLabel?: string | null;
    rightLabel?: string | null;
    onExit: () => void;
}

const MIN_PANE_PCT = 20;
const MAX_PANE_PCT = 80;
const clampPct = (pct: number): number => Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, pct));

// Keep a pane's selected index in range: the route doesn't remount on data
// change, so a smaller re-upload could otherwise leave an index dangling past
// the new graph list and feed `undefined` into MlGraph.
const clampIndex = (index: number, count: number): number => Math.min(Math.max(index, 0), Math.max(count - 1, 0));

type PaneSide = 'left' | 'right';

const MlirSplitView = ({ leftData, rightData, leftLabel = null, rightLabel = null, onExit }: MlirSplitViewProps) => {
    // Display-only swap: flips which prop side is shown left/right without
    // touching persisted primary / comparison atoms.
    const [swapped, setSwapped] = useState(false);
    const [propLeftIndex, setPropLeftIndex] = useState(0);
    const [propRightIndex, setPropRightIndex] = useState(0);
    const [leftPct, setLeftPct] = useState(50);
    const containerRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    const displayLeftData = swapped ? rightData : leftData;
    const displayRightData = swapped ? leftData : rightData;
    const displayLeftLabel = swapped ? rightLabel : leftLabel;
    const displayRightLabel = swapped ? leftLabel : rightLabel;
    const displayLeftIndex = swapped ? propRightIndex : propLeftIndex;
    const displayRightIndex = swapped ? propLeftIndex : propRightIndex;
    const setDisplayLeftIndex = swapped ? setPropRightIndex : setPropLeftIndex;
    const setDisplayRightIndex = swapped ? setPropLeftIndex : setPropRightIndex;

    const safeLeftIndex = clampIndex(displayLeftIndex, displayLeftData.graphs.length);
    const safeRightIndex = clampIndex(displayRightIndex, displayRightData.graphs.length);

    // Per-pane single-graph bundles keep MlGraph unchanged (it renders graphs[0]).
    // useMemo stabilises each bundle's identity so memo(MlGraph) skips re-rendering
    // on unrelated parent updates (e.g. a divider drag); switching graphs still
    // remounts the pane via MlGraph's internal `key={graphs[0].id}`.
    const leftBundle = useMemo<GraphBundle>(
        () => ({ graphs: [displayLeftData.graphs[safeLeftIndex]] }),
        [displayLeftData.graphs, safeLeftIndex],
    );
    const rightBundle = useMemo<GraphBundle>(
        () => ({ graphs: [displayRightData.graphs[safeRightIndex]] }),
        [displayRightData.graphs, safeRightIndex],
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
        setSwapped((current) => !current);
    }, []);

    const renderHeader = (
        side: PaneSide,
        data: GraphBundle,
        index: number,
        setIndex: (next: number) => void,
        label: string | null,
    ) => (
        <header className='mlir-split-pane-header'>
            {label ? <span className='mlir-split-pane-label'>{label}</span> : null}
            <HTMLSelect
                className='mlir-split-pane-select'
                aria-label={`${side} pane graph`}
                value={index}
                onChange={(event) => setIndex(Number(event.currentTarget.value))}
                options={data.graphs.map((graph, i) => ({ value: i, label: graph.id }))}
                minimal
            />
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

    return (
        <div
            className='mlir-split-view'
            ref={containerRef}
        >
            <section
                className='mlir-split-pane'
                style={{ flexBasis: `${leftPct}%` }}
            >
                {renderHeader('left', displayLeftData, safeLeftIndex, setDisplayLeftIndex, displayLeftLabel)}
                <MlGraph data={leftBundle} />
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
                {renderHeader('right', displayRightData, safeRightIndex, setDisplayRightIndex, displayRightLabel)}
                <MlGraph data={rightBundle} />
            </section>
        </div>
    );
};

export default MlirSplitView;
