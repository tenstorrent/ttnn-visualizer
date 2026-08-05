// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';

type ChipId = number;
export type EthChannel = number;
type CoreId = string;

export type ClusterCoordinates = [x: number, y: number, r: number, s: number];

export enum CLUSTER_ETH_POSITION {
    TOP = 'top',
    BOTTOM = 'bottom',
    LEFT = 'left',
    RIGHT = 'right',
}

// A live ethernet port on a chip. Both the uid and the coordinate label are resolved once,
// where the connection is recorded, and read back by the port-placement and render passes.
// Reconstructing either downstream lets the two constructions drift, and a uid mismatch
// renders no links at all rather than failing loudly. #1772
export interface EthPort {
    uid: string;
    chan: EthChannel;
    // Arch-derived `rank-chip-core` coordinate; null when no SoC descriptor is baked. #1772
    coordLabel: string | null;
}

export interface ClusterChip {
    id: number;
    coords: ClusterCoordinates;
    mmio: boolean;
    // Live ports from the cluster descriptor; uids derive from its channels rather than the
    // arch eth list, so a cluster renders with no baked SoC descriptor. #1772
    ethPorts: EthPort[];
    connectedChipsByEthId: Map<string, ClusterChip>;
    // Optional enrichment only (coordinate labels, PCIe markers); null for an unknown arch.
    design: ChipDesign | null;
    // Rank of the host this chip lives on. Defaults to 0 for single-host reports.
    // For multi-host topologies the unique key is `(rank, id)`; local `id`s can collide across ranks.
    rank?: number;
}

export enum CLUSTER_COORDS {
    X,
    Y,
    R,
    S,
}

export enum CLUSTER_BOARD_INDEX {
    BOARD_ID,
    BOARD_TYPE,
    CHIPS,
}
export type ClusterBoard = [
    //
    { board_id: string },
    { board_type: string },
    { chips: ChipId[] },
];

// Raw shape of an `ethernet_connections_to_remote_devices` entry as it lands from the YAML.
// The first endpoint is a local `(chip, chan)`; the second references the remote host's
// `chip_unique_id`, which must be resolved against the union of `chip_unique_ids` across ranks.
export type RemoteEthernetConnectionRaw = [
    { chip: ChipId; chan: EthChannel },
    { remote_chip_id: number; chan: EthChannel },
];

export interface ClusterModel {
    // Keyed by chip id, as the YAML writes it. Optional because a descriptor may omit it
    // entirely, in which case chips render without arch enrichment.
    arch?: Record<ChipId, string>;
    chips: {
        [key: ChipId]: ClusterCoordinates;
    };
    ethernet_connections: EthernetConnections;
    chips_with_mmio: [key: number, ChipId][];

    // Present in per-host cluster descriptors for multi-host reports; absent in legacy single-host.
    ethernet_connections_to_remote_devices?: RemoteEthernetConnectionRaw[];
    chip_to_boardtype: Record<ChipId, string>;
    chip_to_bus_id: Record<ChipId, number>;
    chip_unique_ids: Record<ChipId, number>;
    boards: ClusterBoard[];
}

export interface MeshData {
    chips: {
        [key: ChipId]: ClusterCoordinates;
    };
}

// Multi-doc YAML mesh-descriptor envelope. Backend returns this when a
// `physical_chip_mesh_coordinate_mapping_*.yaml` file contains multiple
// `chips:` documents (one per rank). The FE resolves which doc belongs
// to the requested rank — see `pickMeshDocForRank` in `clusterTopology.ts`.
export interface MeshDataDocs {
    docs: MeshData[];
}

export type MeshDescriptorResponse = MeshData | MeshDataDocs;

type EthernetConnections = [{ chip: ChipId; chan: EthChannel }, { chip: ChipId; chan: EthChannel }][];

// One host's slice of a stitched multi-host topology. For single-host reports the topology
// contains exactly one host with `rank: 0`.
export interface ClusterHost {
    rank: number;
    descriptor: ClusterModel;
    // Mesh coordinates for this host's chips (may be empty if mesh-descriptor was unavailable).
    meshChips: Record<ChipId, ClusterCoordinates>;
}

export interface IntraHostEthernetLink {
    rank: number;
    a: { chip: ChipId; chan: EthChannel };
    b: { chip: ChipId; chan: EthChannel };
}

// A cross-host ethernet link with both endpoints resolved to `(rank, chip, chan)`.
// Produced by joining `ethernet_connections_to_remote_devices.remote_chip_id` against
// the union of `chip_unique_ids` across all hosts.
export interface InterHostEthernetLink {
    a: { rank: number; chip: ChipId; chan: EthChannel; chipUniqueId: number };
    b: { rank: number; chip: ChipId; chan: EthChannel; chipUniqueId: number };
}

export interface ClusterTopology {
    isMultiHost: boolean;
    worldSize: number;
    hosts: ClusterHost[];
    intraHostLinks: IntraHostEthernetLink[];
    interHostLinks: InterHostEthernetLink[];
    // Number of `ethernet_connections_to_remote_devices` entries whose `remote_chip_id`
    // could not be resolved against any host's `chip_unique_ids` (e.g. partial reports).
    unresolvedRemoteCount: number;
}

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
// No default architecture on purpose: guessing one renders another arch's coordinates as
// if they were this report's. An unresolved arch omits the enrichment instead. #1772
