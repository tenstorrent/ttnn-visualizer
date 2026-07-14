// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { CACHE_LIMIT_PER_GRAPH, touchLruCache } from '../src/components/mlir/mlirLayoutWorkerCache';

describe('touchLruCache', () => {
    it('inserts a new entry at the tail', () => {
        const cache = new Map<string, number>();

        touchLruCache(cache, 'a', 1, 5);

        expect([...cache.entries()]).toEqual([['a', 1]]);
    });

    it('re-inserts an existing key at the tail on cache hit (move-to-end)', () => {
        const cache = new Map<string, number>([
            ['a', 1],
            ['b', 2],
            ['c', 3],
        ]);

        touchLruCache(cache, 'a', 1, 5);

        expect([...cache.keys()]).toEqual(['b', 'c', 'a']);
    });

    it('overwrites the value when re-inserting an existing key', () => {
        const cache = new Map<string, number>([['a', 1]]);

        touchLruCache(cache, 'a', 99, 5);

        expect(cache.get('a')).toBe(99);
        expect(cache.size).toBe(1);
    });

    it('evicts the least-recently-used entry when the cache reaches the limit', () => {
        const cache = new Map<string, number>([
            ['a', 1],
            ['b', 2],
            ['c', 3],
        ]);

        touchLruCache(cache, 'd', 4, 3);

        expect([...cache.keys()]).toEqual(['b', 'c', 'd']);
        expect(cache.has('a')).toBe(false);
    });

    it('does not evict on cache hit even when the cache is at the limit', () => {
        const cache = new Map<string, number>([
            ['a', 1],
            ['b', 2],
            ['c', 3],
        ]);

        touchLruCache(cache, 'a', 1, 3);

        expect(cache.size).toBe(3);
        expect([...cache.keys()]).toEqual(['b', 'c', 'a']);
    });

    it('reorders entries so a re-inserted key survives subsequent evictions', () => {
        const cache = new Map<string, number>([
            ['a', 1],
            ['b', 2],
            ['c', 3],
        ]);

        // Refresh 'a' — it should now be MRU.
        touchLruCache(cache, 'a', 1, 3);
        // Cache is at limit; inserting 'd' should evict the current LRU ('b').
        touchLruCache(cache, 'd', 4, 3);

        expect(cache.has('a')).toBe(true);
        expect(cache.has('b')).toBe(false);
        expect([...cache.keys()]).toEqual(['c', 'a', 'd']);
    });

    it('caps at exactly `limit` entries under a monotonically growing insertion stream', () => {
        const cache = new Map<string, number>();

        for (let i = 0; i < 50; i++) {
            touchLruCache(cache, `k${i}`, i, 10);
        }

        expect(cache.size).toBe(10);
        // The last 10 insertions survive; the earlier 40 are evicted.
        expect([...cache.keys()]).toEqual(['k40', 'k41', 'k42', 'k43', 'k44', 'k45', 'k46', 'k47', 'k48', 'k49']);
    });

    it('exposes the graph cache limit as 32', () => {
        expect(CACHE_LIMIT_PER_GRAPH).toBe(32);
    });

    it('handles a limit of 1 (degenerates to single-entry cache)', () => {
        const cache = new Map<string, number>();

        touchLruCache(cache, 'a', 1, 1);
        touchLruCache(cache, 'b', 2, 1);

        expect(cache.size).toBe(1);
        expect([...cache.entries()]).toEqual([['b', 2]]);
    });

    it('works with non-string keys', () => {
        const cache = new Map<number, string>();

        touchLruCache(cache, 1, 'a', 3);
        touchLruCache(cache, 2, 'b', 3);
        touchLruCache(cache, 3, 'c', 3);
        touchLruCache(cache, 4, 'd', 3);

        expect([...cache.keys()]).toEqual([2, 3, 4]);
    });
});
