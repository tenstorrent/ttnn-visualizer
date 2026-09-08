// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Chunk } from '../model/APIData';

/**
 * Collapse a chunk list into a single envelope chunk
 * `{ address, size }` covering `[min(address), max(address + size)]`.
 *
 * Used for the CB / Buffers / L1 "Summary" stripes in the Current
 * Summarized L1 Report.
 *
 * Order-agnostic on purpose: callers feed `cbMemory` / `bufferMemory`
 * built by `deviceOperations.flatMap(op => op.cbList)` (or
 * `op.bufferList`), i.e. graph order rather than address order. The
 * previous in-class implementation used `mem[0].address` as the lower
 * bound and silently produced the wrong envelope whenever the first
 * graph-order chunk wasn't the lowest-address one (e.g. sharded
 * Conv2d / Halo ops whose first CB is globally-allocated at a high
 * address, with the small anonymous CBs sitting much lower in L1).
 * See #1653.
 *
 * Empty input returns the same `{ address: 0, size: 0 }` sentinel the
 * legacy method returned so the chart-data path keeps treating it as
 * "no condensed stripe to draw".
 */
export const calculateCondensed = (mem: Chunk[]): Chunk => {
    if (mem.length === 0) {
        return { address: 0, size: 0 };
    }

    let startAddress = Infinity;
    let rangeEnd = 0;
    for (const chunk of mem) {
        if (chunk.address < startAddress) {
            startAddress = chunk.address;
        }
        const end = chunk.address + chunk.size;
        if (end > rangeEnd) {
            rangeEnd = end;
        }
    }

    return {
        address: startAddress,
        size: rangeEnd - startAddress,
    };
};
