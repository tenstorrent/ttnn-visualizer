// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { ClusterTopology } from '../../src/model/ClusterModel';

// Shared harness for specs that render `ClusterRenderer` against a hand-built topology.

/* eslint-disable class-methods-use-this -- no-op stub has nothing to hold */
/** jsdom has no `ResizeObserver`; this one never reports a size, so zoom stays at 1. Has to
 * be a class — vitest rejects an arrow function used as a constructor mock. */
export class ResizeObserverStub {
    observe() {}

    unobserve() {}

    disconnect() {}
}
/* eslint-enable class-methods-use-this */

/**
 * @description What a mocked `useGetClusterTopology` returns. Call it from inside the hook
 * mock, not the `vi.mock` factory, so each render reads the spec's current topology.
 */
export const topologyQueryResult = (data: ClusterTopology | null | undefined, { isLoading = false } = {}) => ({
    data,
    isLoading,
    isError: false,
    error: null,
});

export interface HostOptions {
    rank: number;
    chipCount: number;
    /** Board slot per chip, eight to a group; omitted means the descriptor carries none. */
    slots?: boolean;
    /** Mesh coordinates per chip, which outrank grouping when every host has them. */
    mesh?: boolean;
    ethernetConnections?: unknown[];
}

/** One host of `chipCount` wormhole chips, with unique ids `rank * 100 + chip`. */
export const hostOf = ({ rank, chipCount, slots, mesh, ethernetConnections = [] }: HostOptions) => {
    const chipIds = Array.from({ length: chipCount }, (_, chip) => chip);
    return {
        rank,
        descriptor: {
            arch: Object.fromEntries(chipIds.map((chip) => [chip, 'wormhole_b0'])),
            chip_unique_ids: Object.fromEntries(chipIds.map((chip) => [chip, String(rank * 100 + chip)])),
            chips_with_mmio: [{ 0: 0 }],
            ethernet_connections: ethernetConnections,
            ...(slots ? { asic_locations: Object.fromEntries(chipIds.map((c) => [c, (c % 8) + 1])) } : {}),
        },
        meshChips: mesh ? Object.fromEntries(chipIds.map((c) => [c, [c, rank, 0, 0]])) : {},
    };
};

/** A topology from its hosts and links; multi-host when there is more than one host. */
export const topologyOfHosts = (
    hosts: ReturnType<typeof hostOf>[],
    { intraHostLinks = [], interHostLinks = [] }: { intraHostLinks?: unknown[]; interHostLinks?: unknown[] } = {},
): ClusterTopology =>
    ({
        isMultiHost: hosts.length > 1,
        worldSize: hosts.length,
        unresolvedRemoteCount: 0,
        hosts,
        intraHostLinks,
        interHostLinks,
    }) as unknown as ClusterTopology;
