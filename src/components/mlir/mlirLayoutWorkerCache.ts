// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Bounds the within-graph cache when the user cycles through many
// distinct expansion sets. Cross-graph eviction is handled by the
// parent's `key={graph.id}` remount.
export const CACHE_LIMIT_PER_GRAPH = 32;

// Move-to-end insertion turns the Map's insertion-order iteration into
// LRU order; the head is then always the least-recently-used entry.
export const touchLruCache = <K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void => {
    if (cache.has(key)) {
        cache.delete(key);
    } else if (cache.size >= limit) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) {
            cache.delete(oldestKey);
        }
    }
    cache.set(key, value);
};
