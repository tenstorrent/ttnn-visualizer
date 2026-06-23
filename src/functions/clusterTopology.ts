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
 * multi-host report. If `ethernet_connections_to_remote_devices` is present
 * (even if empty), we know the backend served us a ranked descriptor.
 */
export const looksLikeRankedDescriptor = (descriptor: ClusterModel): boolean => {
    return descriptor.ethernet_connections_to_remote_devices !== undefined;
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
