// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useMemo } from 'react';
import { LinkUtilization, NPEData, NPE_COORDINATES, NPE_LINK, NoCID, NoCTransfer, NoCType } from '../../model/NPEModel';

interface UseShowActiveTransfersParams {
    npeData: NPEData;
    selectedNode: { index: number } | null;
    selectedTimestep: number;
    nocFilter: NoCType | null;
    onPause: () => void;
    hideAllTransfers: () => void;
    setSelectedNode: (value: { index: number; coords: NPE_COORDINATES } | null) => void;
    setSelectedTransferList: (transfers: NoCTransfer[]) => void;
}

export const useShowActiveTransfers = ({
    npeData,
    selectedNode,
    selectedTimestep,
    nocFilter,
    onPause,
    hideAllTransfers,
    setSelectedNode,
    setSelectedTransferList,
}: UseShowActiveTransfersParams) => {
    return useCallback(
        (linkUtilizationData: LinkUtilization | null, index?: number) => {
            hideAllTransfers();
            if (linkUtilizationData === null || selectedNode?.index === index) {
                setSelectedNode(null);
                setSelectedTransferList([]);
                return;
            }

            if (index !== undefined) {
                setSelectedNode({
                    index,
                    coords: [
                        linkUtilizationData[NPE_LINK.CHIP_ID],
                        linkUtilizationData[NPE_LINK.Y],
                        linkUtilizationData[NPE_LINK.X],
                    ],
                });
            }

            onPause();

            const activeTransfers = npeData.timestep_data[selectedTimestep].active_transfers
                .map((transferId) => {
                    const transfer = npeData.noc_transfers.find((tr) => tr.id === transferId);

                    const routes = transfer?.route
                        ?.map((r) =>
                            r.links.some(
                                (link) =>
                                    link[NPE_LINK.Y] === linkUtilizationData[NPE_LINK.Y] &&
                                    link[NPE_LINK.X] === linkUtilizationData[NPE_LINK.X] &&
                                    (nocFilter === null || link[NPE_LINK.NOC_ID].indexOf(nocFilter) === 0),
                            )
                                ? r
                                : null,
                        )
                        .filter((r) => r !== null);

                    if (routes && routes.length > 0) {
                        return transfer;
                    }
                    return undefined;
                })
                .filter((tr): tr is NoCTransfer => tr !== undefined);

            setSelectedTransferList(activeTransfers);
        },
        [
            npeData,
            selectedTimestep,
            selectedNode,
            nocFilter,
            onPause,
            hideAllTransfers,
            setSelectedNode,
            setSelectedTransferList,
        ],
    );
};

export function useSelectedTransferGrouping(
    selectedTransferList: NoCTransfer[],
    selectedNode: { coords: number[] } | null,
) {
    const transferListSelectionRendering = useMemo(() => {
        const selectedNoCByDevice = new Map<number, Array<Array<Array<{ transfer: number; nocId: NoCID }>>>>();

        selectedTransferList.forEach((transfer) => {
            transfer.route.forEach((route) => {
                route.links.forEach((link) => {
                    const [deviceId, row, col] = link;
                    const list = selectedNoCByDevice.get(deviceId) || [];

                    list[row] = list[row] || [];
                    list[row][col] = list[row][col] || [];
                    list[row][col].push({
                        transfer: transfer.id,
                        nocId: link[NPE_LINK.NOC_ID],
                    });

                    selectedNoCByDevice.set(deviceId, list);
                });
            });
        });

        return selectedNoCByDevice;
    }, [selectedTransferList]);

    const groupedTransfersByNoCID = useMemo<Record<NoCID, NoCTransfer[]>>(() => {
        if (!selectedNode?.coords) {
            return {} as Record<NoCID, NoCTransfer[]>;
        }

        const [targetDeviceID, targetRow, targetCol] = selectedNode.coords;
        const groups: Record<NoCID, NoCTransfer[]> = {} as Record<NoCID, NoCTransfer[]>;

        selectedTransferList.forEach((transfer) => {
            transfer.route.forEach((route) => {
                route.links.forEach((link) => {
                    const [deviceId, row, col] = link;
                    if (deviceId === targetDeviceID && row === targetRow && col === targetCol) {
                        const nocId = link[NPE_LINK.NOC_ID];
                        if (!groups[nocId]) {
                            groups[nocId] = [];
                        }
                        if (!groups[nocId].some((t) => t.id === transfer.id)) {
                            groups[nocId].push(transfer);
                        }
                    }
                });
            });
        });

        return groups;
    }, [selectedTransferList, selectedNode]);

    return {
        transferListSelectionRendering,
        groupedTransfersByNoCID,
    };
}
