// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useArchitecture, useGetClusterDescription } from '../../hooks/useAPI';
import { stringToArchitecture } from '../../definitions/DeviceArchitecture';

import '../../scss/components/ClusterView.scss';
import { CLUSTER_COORDS, CLUSTER_ETH_POSITION, ClusterChip, DEFAULT_ARCHITECTURE } from '../../model/ClusterModel';

const CLUSTER_NODE_GRID_SIZE = 6; // number of cores in a col/row per chip
const CLUSTER_CHIP_SIZE_LARGE = 350;
const CLUSTER_CHIP_SIZE_MEDIUM = 250;
const CLUSTER_CHIP_SIZE_SMALL = 150;

function ClusterRenderer() {
    const navigate = useNavigate();
    const clusterDescription = useGetClusterDescription();
    const data = clusterDescription?.data;
    // we don't support mixed architecture for now
    // we will default to wormhole
    const arch = stringToArchitecture((data?.arch.length && data?.arch[0]) || DEFAULT_ARCHITECTURE);
    const chipDesign = useArchitecture(arch);
    let clusterChipSize = CLUSTER_CHIP_SIZE_LARGE;
    const header = (
        <h1 className='cluster-view-header'>
            <Button
                icon={IconNames.CROSS}
                onClick={() => {
                    navigate(-1);
                }}
            />
        </h1>
    );
    if (!data) {
        return (
            <div className='cluster-view-wrap'>
                {header}
                <p>Loading...</p>
            </div>
        );
    }

    let totalCols = 0;

    const mmioChips = data.chips_with_mmio.map((obj) => {
        return Object.values(obj)[0];
    });

    const connections = data.ethernet_connections;
    const chips = Object.entries(data.chips).map(([ClusterChipId, coords]) => {
        const chipId = parseInt(ClusterChipId, 10);
        totalCols = Math.max(totalCols, coords[CLUSTER_COORDS.X]);

        const chip: ClusterChip = {
            id: chipId,
            coords,
            mmio: mmioChips.includes(chipId),
            connectedChipsByEthId: new Map(),
            eth: chipDesign.eth.map((coreId) => `${ClusterChipId}-${coreId}`),
        };

        chip.design = chipDesign;
        return chip;
    });

    // T3K
    if (chips.length >= 8) {
        clusterChipSize = CLUSTER_CHIP_SIZE_MEDIUM;
    }

    // GALAXY
    if (chips.length >= 32) {
        clusterChipSize = CLUSTER_CHIP_SIZE_SMALL;
    }

    connections.forEach((connection) => {
        const chip0 = chips[connection[0].chip];
        const chip1 = chips[connection[1].chip];
        if (chip0 && chip1) {
            chip0.connectedChipsByEthId.set(chip0.eth[connection[0].chan] ?? '', chip1);
            chip1.connectedChipsByEthId.set(chip1.eth[connection[1].chan] ?? '', chip0);
        }
    });

    return (
        <div className='cluster-view-renderer'>
            {header}
            <div className='cluster-view-wrap'>
                <div
                    className='cluster'
                    style={{
                        gridTemplateColumns: `repeat(${totalCols || 0}, ${clusterChipSize}px)`,
                    }}
                >
                    {chips.map((clusterChip) => {
                        const ethPosition: Map<CLUSTER_ETH_POSITION, string[]> = new Map();

                        clusterChip.design?.eth.forEach((coreId) => {
                            const uid = `${clusterChip.id}-${coreId}`;
                            const connectedChip = clusterChip.connectedChipsByEthId.get(uid);
                            let position: CLUSTER_ETH_POSITION | null = null;
                            if (connectedChip) {
                                if (connectedChip?.coords[CLUSTER_COORDS.X] < clusterChip.coords[CLUSTER_COORDS.X]) {
                                    position = CLUSTER_ETH_POSITION.LEFT;
                                }
                                if (connectedChip?.coords[CLUSTER_COORDS.X] > clusterChip.coords[CLUSTER_COORDS.X]) {
                                    position = CLUSTER_ETH_POSITION.RIGHT;
                                }
                                if (connectedChip?.coords[CLUSTER_COORDS.Y] < clusterChip.coords[CLUSTER_COORDS.Y]) {
                                    position = CLUSTER_ETH_POSITION.TOP;
                                }
                                if (connectedChip?.coords[CLUSTER_COORDS.Y] > clusterChip.coords[CLUSTER_COORDS.Y]) {
                                    position = CLUSTER_ETH_POSITION.BOTTOM;
                                }
                            }
                            if (position) {
                                if (ethPosition.has(position)) {
                                    ethPosition.get(position)?.push(uid);
                                } else {
                                    ethPosition.set(position, [uid]);
                                }
                            }
                        });

                        return (
                            <div
                                className='chip'
                                key={clusterChip.id}
                                style={{
                                    display: 'grid',
                                    width: `${clusterChipSize}px`,
                                    height: `${clusterChipSize}px`,
                                    gridColumn: clusterChip.coords[CLUSTER_COORDS.X] + 1,
                                    gridRow: clusterChip.coords[CLUSTER_COORDS.Y] + 1,
                                    gridTemplateColumns: `repeat(${CLUSTER_NODE_GRID_SIZE}, 1fr)`,
                                    gridTemplateRows: `repeat(${CLUSTER_NODE_GRID_SIZE}, 1fr)`,
                                }}
                            >
                                <span
                                    className='chip-id'
                                    style={{
                                        lineHeight: `${clusterChipSize}px`,
                                        paddingRight: `${clusterChipSize / 4}px`,
                                        paddingTop: `${clusterChipSize / 5}px`,
                                    }}
                                >
                                    {clusterChipSize >= CLUSTER_CHIP_SIZE_MEDIUM && 'Device'} {clusterChip.id}
                                </span>

                                {[...ethPosition.entries()].map(([position, value]) => {
                                    return value.map((uid: string, index: number) => {
                                        const { x, y } = calculateEthPosition(position, index);
                                        const size = clusterChipSize / CLUSTER_NODE_GRID_SIZE - 5; // grid, 5 gap
                                        return (
                                            <div
                                                title={`${uid}`}
                                                key={uid}
                                                className={`eth eth-position-${position}`}
                                                style={{
                                                    gridColumn: x,
                                                    gridRow: y,
                                                    width: `${size}px`,
                                                    height: `${size}px`,
                                                }}
                                            >
                                                <span>{uid}</span>
                                            </div>
                                        );
                                    });
                                })}

                                {clusterChip.mmio && <div className='mmio'>PCIe</div>}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

const calculateEthPosition = (ethPosition: CLUSTER_ETH_POSITION, index: number) => {
    let x = 0;
    let y = 0;
    switch (ethPosition) {
        case CLUSTER_ETH_POSITION.TOP:
            x = index + 2;
            y = 1;
            break;
        case CLUSTER_ETH_POSITION.BOTTOM:
            x = index + 2;
            y = CLUSTER_NODE_GRID_SIZE;
            break;
        case CLUSTER_ETH_POSITION.LEFT:
            x = 1;
            y = index + 2;
            break;
        case CLUSTER_ETH_POSITION.RIGHT:
            x = CLUSTER_NODE_GRID_SIZE;
            y = index + 2;
            break;
        default:
            return { x, y };
    }
    return { x, y };
};

export default ClusterRenderer;
