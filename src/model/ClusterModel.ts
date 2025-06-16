// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';

type ChipId = number;
type EthChannel = number;
type CoreId = string;

export type ClusterCoordinates = [x: number, y: number, r: number, s: number];

export enum CLUSTER_ETH_POSITION {
    TOP = 'top',
    BOTTOM = 'bottom',
    LEFT = 'left',
    RIGHT = 'right',
}

export interface ClusterChip {
    id: number;
    coords: ClusterCoordinates;
    mmio: boolean;
    eth: string[];
    connectedChipsByEthId: Map<string, ClusterChip>;
    design?: ChipDesign;
}

export enum CLUSTER_COORDS {
    X,
    Y,
    R,
    S,
}

export interface ClusterModel {
    arch: string[];
    chips: {
        [key: ChipId]: ClusterCoordinates;
    };
    ethernet_connections: EthernetConnections;
    chips_with_mmio: [key: number, ChipId][];
}

type EthernetConnections = [{ chip: ChipId; chan: EthChannel }, { chip: ChipId; chan: EthChannel }][];

export interface DeviceDescriptorJSON {
    eth: CoreId[];
}
export interface ChipDesign {
    arch_name: DeviceArchitecture;
    grid: { x_size: number; y_size: number };
    arc: string[];
    dram: string[][];
    eth: string[];
    pcie: string[];
    router_only: string[];
    functional_workers: string[];

    [unknownKey: string]: unknown;
}
export const DEFAULT_ARCHITECTURE = 'Wormhole';
