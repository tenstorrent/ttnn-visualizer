// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import { calculateCondensed } from '../src/functions/calculateCondensed';
import { Chunk } from '../src/model/APIData';

const c = (address: number, size: number): Chunk => ({ address, size });

describe('calculateCondensed', () => {
    it('returns the {0, 0} sentinel for an empty input', () => {
        // cbMemory / bufferMemory degenerate to `[]` when bufferType isn't L1
        // (see the ternaries in OperationDetails.memoryData). The chart-data
        // path treats {0, 0} as "no condensed stripe to draw".
        expect(calculateCondensed([])).toEqual({ address: 0, size: 0 });
    });

    it('collapses a single chunk to itself', () => {
        expect(calculateCondensed([c(1024, 256)])).toEqual({ address: 1024, size: 256 });
    });

    it('returns the envelope for an address-sorted input', () => {
        const mem = [c(0x100, 0x40), c(0x200, 0x80), c(0x400, 0x20)];
        // envelope: [0x100, 0x400 + 0x20] -> address=0x100, size=0x320
        expect(calculateCondensed(mem)).toEqual({ address: 0x100, size: 0x320 });
    });

    // Core regression for #1653: same chunks, scrambled order. Result must
    // be identical to the sorted case; the legacy `mem[0].address` shortcut
    // used to silently produce the wrong lower bound here.
    it('returns the same envelope regardless of input order', () => {
        const sorted = [c(0x100, 0x40), c(0x200, 0x80), c(0x400, 0x20)];
        const scrambled = [c(0x400, 0x20), c(0x100, 0x40), c(0x200, 0x80)];

        const fromSorted = calculateCondensed(sorted);
        const fromScrambled = calculateCondensed(scrambled);

        expect(fromScrambled).toEqual(fromSorted);
        expect(fromScrambled.address).toBe(0x100);
        expect(fromScrambled.size).toBe(0x320);
    });

    it('uses min(address) as the lower bound even when the first element is high', () => {
        // Graph-order pattern that hit the bug in production: the first
        // CB pushed onto cbMemory is a globally-allocated CB at a high
        // address, with smaller anonymous CBs further down.
        const mem = [c(0x1000, 0x100), c(0x80, 0x10), c(0x90, 0x20)];

        const result = calculateCondensed(mem);

        expect(result.address).toBe(0x80);
        expect(result.size).toBe(0x1000 + 0x100 - 0x80);
    });

    it('uses max(address + size) as the upper bound even when the largest end is interior', () => {
        // Variant: highest end-of-range sits on a chunk that's neither
        // first nor last in the array. Ensures rangeEnd really is a max,
        // not an end-of-array read.
        const mem = [c(0x100, 0x10), c(0x200, 0x800), c(0x180, 0x20)];

        const result = calculateCondensed(mem);

        expect(result.address).toBe(0x100);
        expect(result.size).toBe(0x200 + 0x800 - 0x100);
    });

    it('treats overlapping chunks as a single span', () => {
        // CB aliasing (a `globally_allocated=1` CB sharing an address with
        // a sharded tensor) shows up here as two chunks at the same start.
        // Envelope semantics: union of ranges, single contiguous stripe.
        const mem = [c(0x1000, 0x800), c(0x1000, 0x800)];

        expect(calculateCondensed(mem)).toEqual({ address: 0x1000, size: 0x800 });
    });

    // Regression pin against the resnet50_main_jun10_2110 / op 8 numbers
    // documented in #1653. Pulled straight from the captured_graph blob
    // so anyone touching this code can see the exact bytes the tooltip
    // used to read and what they should read instead.
    it('matches the resnet50 op-8 CB envelope: [103840, 1499108] / ~1.33 MiB', () => {
        const op8Cbs: Chunk[] = [
            // HaloDeviceOperation CBs (graph order, as flatMap'd into cbMemory)
            { address: 1_137_312, size: 105_824 }, // CB 65 — bug used this as the lower bound
            { address: 1_360_480, size: 114_080 }, // CB 66
            { address: 103_840, size: 32 }, // CB 67 — actual lowest address
            { address: 103_872, size: 32 }, // CB 68
            { address: 1_499_104, size: 4 }, // CB 69 — sets the upper bound (1,499,108)
            { address: 1_499_072, size: 4 }, // CB 70
            { address: 1_499_040, size: 28 }, // CB 71
            { address: 1_499_008, size: 16 }, // CB 72
            // Conv2dDeviceOperation CBs
            { address: 103_840, size: 17_408 }, // CB 107
            { address: 1_147_232, size: 213_248 }, // CB 108 (globally_allocated)
            { address: 121_248, size: 124_928 }, // CB 109
            { address: 246_176, size: 116_736 }, // CB 110
            { address: 362_912, size: 426_496 }, // CB 111
            { address: 789_408, size: 2_176 }, // CB 112
            { address: 1_147_232, size: 213_248 }, // CB 113 (globally_allocated, same addr as 108)
            { address: 1_498_848, size: 136 }, // CB 114 (globally_allocated)
            { address: 791_584, size: 64 }, // CB 115
            { address: 1_360_480, size: 114_080 }, // CB 116 (globally_allocated, same addr as 66)
        ];

        const result = calculateCondensed(op8Cbs);

        expect(result.address).toBe(103_840);
        expect(result.size).toBe(1_499_108 - 103_840);
        // ~ 1.33 MiB. Pre-fix, this stripe read 353.32 KiB.
        expect(result.size).toBe(1_395_268);
    });
});
