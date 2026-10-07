// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** The allocation failures tt-metal raises, named after the check that raises each. */
export enum AllocationFailureKind {
    // `tt_metal/impl/allocator/bank_manager.cpp`
    BANK_OUT_OF_MEMORY = 'bank_out_of_memory',
    BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES = 'bank_out_of_memory_with_dependencies',
    // `tt_metal/impl/program/program.cpp`
    CIRCULAR_BUFFERS_BEYOND_L1 = 'circular_buffers_beyond_l1',
    CIRCULAR_BUFFERS_CLASH = 'circular_buffers_clash',
}

export const ALLOCATION_FAILURE_KIND_LABELS: Record<AllocationFailureKind, string> = {
    [AllocationFailureKind.BANK_OUT_OF_MEMORY]: 'Out of memory',
    [AllocationFailureKind.BANK_OUT_OF_MEMORY_WITH_DEPENDENCIES]: 'Out of memory after dependencies',
    [AllocationFailureKind.CIRCULAR_BUFFERS_BEYOND_L1]: 'Circular buffers beyond L1',
    [AllocationFailureKind.CIRCULAR_BUFFERS_CLASH]: 'Circular buffers clash with L1 buffers',
};

// Enough to show a pattern without pushing the table below the fold; a run usually
// stops at its first failure, so a longer list means the script caught and retried.
export const MAX_ALLOCATION_FAILURES_LISTED = 5;
