// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Move-to-end insertion turns the Map's insertion-order iteration into
// LRU order; the head is then always the least-recently-used entry.
// Uses the iterator's `done` sentinel rather than `oldest.value !== undefined`
// so eviction still fires for callers whose key type admits `undefined`.
export const touchLruCache = <K, V>(cache: Map<K, V>, key: K, value: V, limit: number): void => {
    if (cache.has(key)) {
        cache.delete(key);
    } else if (cache.size >= limit) {
        const oldest = cache.keys().next();
        if (!oldest.done) {
            cache.delete(oldest.value);
        }
    }
    cache.set(key, value);
};
