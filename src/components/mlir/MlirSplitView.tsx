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
    data: GraphBundle;
    onExit: () => void;
}

const MIN_PANE_PCT = 20;
const MAX_PANE_PCT = 80;
const clampPct = (pct: number): number => Math.min(MAX_PANE_PCT, Math.max(MIN_PANE_PCT, pct));

type PaneSide = 'left' | 'right';

const MlirSplitView = ({ data, onExit }: MlirSplitViewProps) => {
    const { graphs } = data;
    const [leftIndex, setLeftIndex] = useState(0);
    // Both panes open on the same graph; the header select re-points either side.
    const [rightIndex, setRightIndex] = useState(0);
    const [leftPct, setLeftPct] = useState(50);
    const containerRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    // Derived single-graph bundles keep MlGraph unchanged (it renders graphs[0]);
    // memoised so a pane only remounts when its own selection changes.
    const leftBundle = useMemo<GraphBundle>(() => ({ graphs: [graphs[leftIndex]] }), [graphs, leftIndex]);
    const rightBundle = useMemo<GraphBundle>(() => ({ graphs: [graphs[rightIndex]] }), [graphs, rightIndex]);

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
        event.currentTarget.releasePointerCapture(event.pointerId);
    }, []);

    const swapPanes = useCallback(() => {
        setLeftIndex(rightIndex);
        setRightIndex(leftIndex);
    }, [leftIndex, rightIndex]);

    const renderHeader = (side: PaneSide, index: number, setIndex: (next: number) => void) => (
        <header className='mlir-split-pane-header'>
            <HTMLSelect
                className='mlir-split-pane-select'
                aria-label={`${side} pane graph`}
                value={index}
                onChange={(event) => setIndex(Number(event.currentTarget.value))}
                options={graphs.map((graph, i) => ({ value: i, label: graph.id }))}
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
                    aria-label={`Close ${side} pane`}
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
                {renderHeader('left', leftIndex, setLeftIndex)}
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
                {renderHeader('right', rightIndex, setRightIndex)}
                <MlGraph data={rightBundle} />
            </section>
        </div>
    );
};

export default MlirSplitView;
