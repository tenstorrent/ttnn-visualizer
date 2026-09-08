// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The cache-of-one behind the shared op<->perf match. Two properties are
 * load-bearing: it must not recompute when every argument is reference-equal (the
 * result is a `useMemo` dependency downstream, so a fresh identity per render
 * would undo those memos), and it must never pair one call's arguments with
 * another call's result.
 */

import { describe, expect, it, vi } from 'vitest';
import memoiseLatest from '../src/functions/memoiseLatest';

describe('memoiseLatest', () => {
    it('computes once for reference-equal arguments and returns the same result', () => {
        const compute = vi.fn((rows: number[]) => rows.map((row) => row * 2));
        const memoised = memoiseLatest(compute);
        const rows = [1, 2, 3];

        const first = memoised(rows);
        const second = memoised(rows);

        expect(compute).toHaveBeenCalledTimes(1);
        expect(second).toBe(first);
    });

    it('recomputes when an argument changes by reference alone', () => {
        const compute = vi.fn((rows: number[]) => rows.length);
        const memoised = memoiseLatest(compute);

        memoised([1, 2]);
        memoised([1, 2]);

        expect(compute).toHaveBeenCalledTimes(2);
    });

    it('recomputes when a later argument changes but earlier ones do not', () => {
        // The real transition: devices resolve after the report, so the match runs
        // first with a device count of 0 and again with the true count.
        const compute = vi.fn((operations: string[], report: string[], deviceCount: number) => ({
            operations,
            report,
            deviceCount,
        }));
        const memoised = memoiseLatest(compute);
        const operations = ['Matmul'];
        const report = ['row'];

        const beforeDevices = memoised(operations, report, 0);
        const afterDevices = memoised(operations, report, 2);

        expect(compute).toHaveBeenCalledTimes(2);
        expect(beforeDevices.deviceCount).toBe(0);
        expect(afterDevices.deviceCount).toBe(2);
    });

    it('never returns another argument set’s result when two callers alternate', () => {
        const compute = vi.fn((rows: number[]) => rows.join(','));
        const memoised = memoiseLatest(compute);
        const first = [1];
        const second = [2];

        expect(memoised(first)).toBe('1');
        expect(memoised(second)).toBe('2');
        expect(memoised(first)).toBe('1');
        expect(compute).toHaveBeenCalledTimes(3);
    });

    it('recomputes when the number of arguments changes', () => {
        const compute = vi.fn((...rows: (number | undefined)[]) => rows.length);
        const memoised = memoiseLatest(compute);

        expect(memoised(1)).toBe(1);
        expect(memoised(1, undefined)).toBe(2);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it('does not cache a result against the arguments of a throwing call', () => {
        // Recording the arguments before `compute` returns would pair the new
        // arguments with the previous result, and every later call with those
        // arguments would be served it from cache — permanently, and silently.
        const compute = vi.fn((rows: number[]) => {
            if (rows.length === 0) {
                throw new Error('empty');
            }

            return rows.join(',');
        });
        const memoised = memoiseLatest(compute);
        const populated = [1];
        const empty: number[] = [];

        expect(memoised(populated)).toBe('1');
        expect(() => memoised(empty)).toThrow('empty');
        expect(() => memoised(empty)).toThrow('empty');
        expect(memoised(populated)).toBe('1');
    });

    it('recomputes after a reset, and stops referencing what it held', () => {
        const compute = vi.fn((rows: number[]) => rows.length);
        const memoised = memoiseLatest(compute);
        const rows = [1, 2];

        memoised(rows);
        memoised.reset();
        memoised(rows);

        expect(compute).toHaveBeenCalledTimes(2);
    });
});
