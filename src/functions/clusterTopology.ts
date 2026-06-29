// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import {
    ClusterHost,
    ClusterModel,
    ClusterTopology,
    InterHostEthernetLink,
    IntraHostEthernetLink,
    MeshData,
    MeshDescriptorResponse,
    RemoteEthernetConnectionRaw,
} from '../model/ClusterModel';

// Width of the per-host condensed-layout grid. Shared with `ClusterRenderer`
// so the host-ordering heuristic and the renderer stay in lockstep. #1510
export const FALLBACK_PER_HOST_COLS = 4;

/**
 * Stitch per-rank cluster descriptors and mesh-coordinate mappings into a unified
 * topology. Pure; single-host reports pass a 1-element array. #1510
 */
export interface PerRankInput {
    rank: number;
    descriptor: ClusterModel;
    meshDescriptor: ClusterModel['chips'] | null;
}

export function stitchClusterTopology(perRankInputs: PerRankInput[]): ClusterTopology {
    const sortedInputs = [...perRankInputs].sort((a, b) => a.rank - b.rank);
    const worldSize = sortedInputs.length;
    const isMultiHost = worldSize > 1;

    const hosts: ClusterHost[] = sortedInputs.map(({ rank, descriptor, meshDescriptor }) => ({
        rank,
        descriptor,
        meshChips: meshDescriptor ?? {},
    }));

    const intraHostLinks: IntraHostEthernetLink[] = [];
    for (const host of hosts) {
        const conns = host.descriptor.ethernet_connections ?? [];
        for (const [a, b] of conns) {
            intraHostLinks.push({
                rank: host.rank,
                a: { chip: a.chip, chan: a.chan },
                b: { chip: b.chip, chan: b.chan },
            });
        }
    }

    // Build a global index from chip_unique_id -> (rank, local chip id) so we can
    // resolve `remote_chip_id` entries against any host's chip_unique_ids map.
    const uniqueIdToOwner = new Map<number, { rank: number; chip: number }>();
    for (const host of hosts) {
        for (const [chipIdStr, uniqueId] of Object.entries(host.descriptor.chip_unique_ids ?? {})) {
            uniqueIdToOwner.set(uniqueId, { rank: host.rank, chip: parseInt(chipIdStr, 10) });
        }
    }

    const seenInterLinks = new Set<string>();
    const interHostLinks: InterHostEthernetLink[] = [];
    let unresolvedRemoteCount = 0;

    for (const host of hosts) {
        const remoteConnections = host.descriptor.ethernet_connections_to_remote_devices ?? [];
        for (const [local, remote] of remoteConnections as RemoteEthernetConnectionRaw[]) {
            const remoteOwner = uniqueIdToOwner.get(remote.remote_chip_id);
            const localChipUniqueId = host.descriptor.chip_unique_ids?.[local.chip];
            if (!remoteOwner || localChipUniqueId === undefined) {
                // Unresolvable: either the remote uid isn't advertised by any host
                // we know about, or this host's own chip is missing a unique id.
                unresolvedRemoteCount += 1;
            } else {
                const endpointA = {
                    rank: host.rank,
                    chip: local.chip,
                    chan: local.chan,
                    chipUniqueId: localChipUniqueId,
                };
                const endpointB = {
                    rank: remoteOwner.rank,
                    chip: remoteOwner.chip,
                    chan: remote.chan,
                    chipUniqueId: remote.remote_chip_id,
                };

                const key = canonicalInterHostLinkKey(endpointA, endpointB);
                if (!seenInterLinks.has(key)) {
                    seenInterLinks.add(key);
                    // Order endpoints canonically so consumers don't have to guess which side is which.
                    const [a, b] = orderEndpoints(endpointA, endpointB);
                    interHostLinks.push({ a, b });
                }
            }
        }
    }

    return {
        isMultiHost,
        worldSize,
        hosts,
        intraHostLinks,
        interHostLinks,
        unresolvedRemoteCount,
    };
}

type Endpoint = InterHostEthernetLink['a'];

const endpointKey = (endpoint: Endpoint) => `${endpoint.rank}:${endpoint.chip}:${endpoint.chan}`;

const orderEndpoints = (a: Endpoint, b: Endpoint): [Endpoint, Endpoint] => {
    return endpointKey(a) <= endpointKey(b) ? [a, b] : [b, a];
};

const canonicalInterHostLinkKey = (a: Endpoint, b: Endpoint): string => {
    const [first, second] = orderEndpoints(a, b);
    return `${endpointKey(first)}__${endpointKey(second)}`;
};

/** True when at least one mesh axis varies; accepts 1D meshes. #1510 */
export const hostHasMeshCoords = (host: ClusterHost): boolean => {
    const coords = Object.values(host.meshChips);
    if (coords.length === 0) {
        return false;
    }
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const coord of coords) {
        xs.add(coord[0]);
        ys.add(coord[1]);
    }
    return xs.size > 1 || ys.size > 1;
};

/** True when both mesh axes vary (proper 2D arrangement). #1510 */
export const hostHasTwoDimensionalMesh = (host: ClusterHost): boolean => {
    const coords = Object.values(host.meshChips);
    if (coords.length === 0) {
        return false;
    }
    const xs = new Set<number>();
    const ys = new Set<number>();
    for (const coord of coords) {
        xs.add(coord[0]);
        ys.add(coord[1]);
    }
    return xs.size > 1 && ys.size > 1;
};

/**
 * True iff this descriptor looks like a per-rank slice of a multi-host report.
 * Requires BOTH `ethernet_connections_to_remote_devices` and `chip_unique_ids`
 * to be non-empty — single-host reports omit these and a more permissive check
 * would trigger spurious world-size probes against the unranked descriptor.
 */
export const looksLikeRankedDescriptor = (descriptor: ClusterModel): boolean => {
    const remoteConnections = descriptor.ethernet_connections_to_remote_devices;
    if (!Array.isArray(remoteConnections) || remoteConnections.length === 0) {
        return false;
    }
    const chipUniqueIds = descriptor.chip_unique_ids;
    if (!chipUniqueIds || Object.keys(chipUniqueIds).length === 0) {
        return false;
    }
    return true;
};

const isMeshDocsEnvelope = (response: MeshDescriptorResponse): response is { docs: MeshData[] } => {
    return Array.isArray((response as { docs?: unknown }).docs);
};

const minMeshY = (doc: MeshData): number => {
    const coords = Object.values(doc.chips ?? {});
    if (coords.length === 0) {
        return Number.POSITIVE_INFINITY;
    }
    return coords.reduce((acc, coord) => Math.min(acc, coord[1] ?? 0), Number.POSITIVE_INFINITY);
};

/**
 * Pick the `MeshData` doc for `rank` from either a single-doc response or the
 * multi-doc envelope. Multi-doc convention: lower ranks own lower mesh-y, so
 * we sort by min-y and index by rank until tt-metal embeds explicit rank tags.
 *
 * Always returns a `MeshData` with a defined `chips` map; defends against
 * empty backend payloads (e.g. `{}`) that would otherwise leak `undefined`
 * through to the renderer.
 */
export const pickMeshDocForRank = (response: MeshDescriptorResponse, rank: number): MeshData => {
    if (!isMeshDocsEnvelope(response)) {
        return response.chips ? response : { chips: {} };
    }
    const sorted = [...response.docs].sort((a, b) => minMeshY(a) - minMeshY(b));
    return sorted[rank] ?? sorted[0] ?? { chips: {} };
};

/**
 * Stack order for hosts in the condensed layout: hosts whose inter-host link
 * endpoints cluster near their LOCAL bottom row come first, so each host's
 * connecting row faces the gutter. Ties fall back to rank-descending.
 */
export const sortHostsByConnectionProximity = (
    hosts: ClusterHost[],
    interHostLinks: InterHostEthernetLink[],
): ClusterHost[] => {
    const localGridYForChip = new Map<string, number>();
    for (const host of hosts) {
        const uidChipIds = Object.keys(host.descriptor.chip_unique_ids ?? {})
            .map(Number)
            .sort((a, b) => a - b);
        uidChipIds.forEach((chipId, idx) => {
            localGridYForChip.set(`${host.rank}-${chipId}`, Math.floor(idx / FALLBACK_PER_HOST_COLS));
        });
    }
    const accumByRank = new Map<number, { sum: number; count: number }>();
    for (const link of interHostLinks) {
        for (const endpoint of [link.a, link.b] as const) {
            const localY = localGridYForChip.get(`${endpoint.rank}-${endpoint.chip}`);
            if (localY !== undefined) {
                const acc = accumByRank.get(endpoint.rank) ?? { sum: 0, count: 0 };
                acc.sum += localY;
                acc.count += 1;
                accumByRank.set(endpoint.rank, acc);
            }
        }
    }
    const meanLocalYByRank = new Map<number, number>();
    accumByRank.forEach((acc, rank) => meanLocalYByRank.set(rank, acc.sum / acc.count));
    return [...hosts].sort((a, b) => {
        const ya = meanLocalYByRank.get(a.rank);
        const yb = meanLocalYByRank.get(b.rank);
        if (ya !== undefined && yb !== undefined && ya !== yb) {
            return yb - ya;
        }
        return b.rank - a.rank;
    });
};
