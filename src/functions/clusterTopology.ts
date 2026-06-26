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

// Per-host fallback layout's column width. The host-ordering heuristic below
// uses the same number to compute each chip's local-row, so any change here
// must stay in sync with `FALLBACK_PER_HOST_COLS` in `ClusterRenderer.tsx`.
const FALLBACK_PER_HOST_COLS = 4;

/**
 * Stitch per-rank cluster descriptors and mesh-coordinate mappings into a unified
 * topology. Pure: no React, no fetch — designed to be testable in isolation.
 *
 * Responsibilities:
 *   1. Collect intra-host ethernet links from each rank's `ethernet_connections`.
 *   2. Resolve each rank's `ethernet_connections_to_remote_devices` against the
 *      union of `chip_unique_ids` across all hosts.
 *   3. Dedupe symmetric inter-host links (each link is listed on both hosts' side).
 *   4. Surface counts of unresolved remote links so callers can warn rather than crash.
 *
 * Single-host reports just pass a one-element `perRankInputs` array and get a
 * `ClusterTopology` with `isMultiHost: false`.
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

/**
 * Heuristic for detecting that a per-rank cluster descriptor is part of a
 * multi-host report. A ranked descriptor must have BOTH:
 *
 *   - a non-empty `ethernet_connections_to_remote_devices` array (cross-host
 *     ethernet links — single-host reports don't have any), AND
 *   - a populated `chip_unique_ids` map (used to resolve remote chip ids
 *     against other ranks).
 *
 * Requiring both guards against:
 *   - galaxy / legacy single-host reports that omit these fields entirely
 *     (`undefined`) and would otherwise pass a more permissive check
 *   - backends that serialise the missing field as `null` / `[]` rather
 *     than dropping it from the JSON
 *
 * Without this, a single-host report can falsely look ranked and trigger
 * the world-size probe up to `MAX_PROBE_RANKS`, since the backend serves
 * the unranked `cluster_descriptor.yaml` for any `?rank=N`.
 */
/**
 * True when this host's mesh-descriptor places its chips at meaningfully
 * distinct positions on at least one axis. Accepts 1D meshes — e.g. the
 * multi-host POC reports where every chip has `mesh_x=0` but `mesh_y`
 * spans the world. A fully degenerate mesh (every chip at the same point)
 * returns false; an empty mesh returns false. #1510
 */
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

/** True when every host has a true 2D mesh (both axes vary). #1510 */
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
 * Resolve a mesh-descriptor response to the single `MeshData` doc that
 * corresponds to `rank`. Handles both legacy single-doc responses and the
 * multi-doc envelope (`{ docs: [...] }`) the backend uses for multi-host
 * reports.
 *
 * For multi-doc envelopes, the convention is "lower ranks occupy lower mesh-y
 * values" — we sort docs by their minimum y-coordinate ascending and index by
 * rank. This is a heuristic forced by the fact that mesh-descriptor files do
 * not currently embed an explicit per-doc rank marker; once tt-metal-side
 * tagging lands we can switch to the explicit marker without breaking the
 * envelope contract.
 */
export const pickMeshDocForRank = (response: MeshDescriptorResponse, rank: number): MeshData => {
    if (!isMeshDocsEnvelope(response)) {
        return response;
    }
    const sorted = [...response.docs].sort((a, b) => minMeshY(a) - minMeshY(b));
    return sorted[rank] ?? sorted[0] ?? { chips: {} };
};

/**
 * Determine the stack order of hosts in the renderer's fallback layout based
 * on where each host's inter-host connection chips sit in its local 4-wide-
 * 2-row grid:
 *
 *   - For each host, compute the mean local-y (0 = top row, 1 = bottom row)
 *     of its inter-host link endpoints.
 *   - Sort descending: hosts whose connecting chips cluster near their
 *     BOTTOM row come first (placed top of the stack), so their bottom row
 *     faces the gutter and lines up across from the next host's top row.
 *   - Ties — and hosts with no inter-host links — fall back to rank
 *     descending so the highest rank is still drawn on top.
 *
 * Returns a new array; the input is not mutated.
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
