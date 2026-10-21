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
    dispatch?: number[][];
    // Narrow on purpose: clicking bare backdrop can only clear a selection. A wider
    // handler would tempt callers into passing the per-scrub-unstable
    // `showActiveTransfers`, which would silently void the memo below.
    onEmptyCellClick: () => void;
    selectedZoneAddress?: NPE_COORDINATES | null;
    isAnnotatingCores: boolean;
    TENSIX_SIZE: number;
    renderChipId: boolean;
}

// Values are the `node-type-*` class suffixes in NPEComponent.scss.
enum NodeKind {
    TENSIX = 'c',
    DRAM = 'd',
    ETH = 'e',
    PCIE = 'p',
    DISPATCH = 'dispatch',
}

// Upper case for the programmable cores (Tensix, dispatch engines), lower case for endpoints.
const NODE_KIND_LABEL: Record<NodeKind, string> = {
    [NodeKind.TENSIX]: 'T',
    [NodeKind.DRAM]: 'd',
    [NodeKind.ETH]: 'e',
    [NodeKind.PCIE]: 'p',
    [NodeKind.DISPATCH]: 'D',
};

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
        dispatch,
        onEmptyCellClick,
        selectedZoneAddress,
        isAnnotatingCores,
        TENSIX_SIZE,
        renderChipId = true,
    }: EmptyChipRendererProps) => {
        // Flatten the node-type location lists into one `${y}-${x}` lookup so a
        // cell resolves in O(1) instead of scanning every array per cell.
        const nodeTypeByCoord = useMemo(() => {
            const byCoord = new Map<string, NodeKind>();
            // First match wins, in the order added below: a plain `set` would silently
            // relabel a coordinate that appears in two arch lists.
            const add = (locations: number[][] | undefined, kind: NodeKind) =>
                locations?.forEach((loc) => {
                    const key = `${loc[0]}-${loc[1]}`;
                    if (!byCoord.has(key)) {
                        byCoord.set(key, kind);
                    }
                });
            add(cores, NodeKind.TENSIX);
            add(dram, NodeKind.DRAM);
            add(eth, NodeKind.ETH);
            add(pcie, NodeKind.PCIE);
            add(dispatch, NodeKind.DISPATCH);
            return byCoord;
        }, [cores, dram, eth, pcie, dispatch]);

        const getNodeType = (location: number[]): JSX.Element => {
            const kind = nodeTypeByCoord.get(`${location[0]}-${location[1]}`);
            return kind ? (
                <div className={`node-type-label node-type-${kind}`}>{NODE_KIND_LABEL[kind]}</div>
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
