// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { JSX } from 'react';
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
    showActiveTransfers: (arg: null) => void;
    selectedZoneAddress?: NPE_COORDINATES | null;
    isAnnotatingCores: boolean;
    TENSIX_SIZE: number;
    renderChipId: boolean;
}

export const EmptyChipRenderer: React.FC<EmptyChipRendererProps> = ({
    id,
    width,
    height,
    cores,
    dram,
    eth,
    pcie,
    showActiveTransfers,
    selectedZoneAddress,
    isAnnotatingCores,
    TENSIX_SIZE,
    renderChipId = true,
}: EmptyChipRendererProps) => {
    const getNodeType = (location: number[]): JSX.Element => {
        const [y, x] = location;
        if (cores?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-c'>T</div>;
        }
        if (dram?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-d'>d</div>;
        }
        if (eth?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-e'>e</div>;
        }
        if (pcie?.some((loc) => loc[0] === y && loc[1] === x)) {
            return <div className='node-type-label node-type-p'>p</div>;
        }
        return <div className='node-type-label' />;
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
                            onClick={() => showActiveTransfers(null)}
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
};
