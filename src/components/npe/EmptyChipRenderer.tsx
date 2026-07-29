// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { JSX, memo, useMemo } from 'react';
import classNames from 'classnames';
import { NPE_COORDINATES, NPE_COORDINATE_INDEX } from '../../model/NPEModel';

interface EmptyChipRendererProps {
    id: number;
    width: number;
    height: number;
    cores?: number[][];
    dram?: number[][];
    eth?: number[][];
    pcie?: number[][];
    // Narrow on purpose: clicking bare backdrop can only clear a selection. A wider
    // handler would tempt callers into passing the per-scrub-unstable
    // `showActiveTransfers`, which would silently void the memo below.
    onEmptyCellClick: () => void;
    selectedZoneAddress?: NPE_COORDINATES | null;
    isAnnotatingCores: boolean;
    TENSIX_SIZE: number;
    renderChipId: boolean;
}

const NODE_TYPE_CLASS: Record<string, string> = {
    c: 'node-type-label node-type-c',
    d: 'node-type-label node-type-d',
    e: 'node-type-label node-type-e',
    p: 'node-type-label node-type-p',
};
const NODE_TYPE_LABEL: Record<string, string> = { c: 'T', d: 'd', e: 'e', p: 'p' };

// This backdrop is static across timesteps, so it's memoized to skip re-rendering
// its width×height cells on every scrub — the dominant data-independent cost of
// timeline navigation (#1803). It only re-renders when the layout/annotation
// inputs actually change, so the handler prop must stay referentially stable.
export const EmptyChipRenderer = memo(
    ({
        id,
        width,
        height,
        cores,
        dram,
        eth,
        pcie,
        onEmptyCellClick,
        selectedZoneAddress,
        isAnnotatingCores,
        TENSIX_SIZE,
        renderChipId = true,
    }: EmptyChipRendererProps) => {
        // Flatten the four node-type location lists into one `${y}-${x}` lookup so a
        // cell resolves in O(1) instead of scanning all four arrays per cell.
        const nodeTypeByCoord = useMemo(() => {
            const byCoord = new Map<string, string>();
            // First match wins, matching the original cores → dram → eth → pcie
            // lookup chain. A plain `set` would make it last-wins and silently
            // relabel any coordinate that appeared in two arch lists.
            const add = (locations: number[][] | undefined, kind: string) =>
                locations?.forEach((loc) => {
                    const key = `${loc[0]}-${loc[1]}`;
                    if (!byCoord.has(key)) {
                        byCoord.set(key, kind);
                    }
                });
            add(cores, 'c');
            add(dram, 'd');
            add(eth, 'e');
            add(pcie, 'p');
            return byCoord;
        }, [cores, dram, eth, pcie]);

        const getNodeType = (location: number[]): JSX.Element => {
            const kind = nodeTypeByCoord.get(`${location[0]}-${location[1]}`);
            return kind ? (
                <div className={NODE_TYPE_CLASS[kind]}>{NODE_TYPE_LABEL[kind]}</div>
            ) : (
                <div className='node-type-label' />
            );
        };

        return (
            <div
                className='tensix-grid empty'
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${width || 0}, ${TENSIX_SIZE}px)`,
                    gridTemplateRows: `repeat(${height || 0}, ${TENSIX_SIZE}px)`,
                }}
            >
                {renderChipId && <div className='chip-id'>{id}</div>}

                {Array.from({ length: width }).map((_, x) =>
                    Array.from({ length: height }).map((__, y) => {
                        const isSelectedZone =
                            selectedZoneAddress &&
                            selectedZoneAddress[NPE_COORDINATE_INDEX.CHIP_ID] === id &&
                            selectedZoneAddress[NPE_COORDINATE_INDEX.Y] === y &&
                            selectedZoneAddress[NPE_COORDINATE_INDEX.X] === x;
                        return (
                            // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
                            <div
                                className={classNames('tensix empty-tensix', {
                                    'selected-zone': isSelectedZone,
                                })}
                                onClick={onEmptyCellClick}
                                style={{
                                    gridColumn: x + 1,
                                    gridRow: y + 1,
                                    width: `${TENSIX_SIZE}px`,
                                    height: `${TENSIX_SIZE}px`,
                                }}
                                key={`${x}-${y}`}
                            >
                                {isAnnotatingCores ? getNodeType([y, x]) : ''}
                            </div>
                        );
                    }),
                )}
            </div>
        );
    },
);
EmptyChipRenderer.displayName = 'EmptyChipRenderer';
