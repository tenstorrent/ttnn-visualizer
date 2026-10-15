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

/** Why an allocation did not fit, as its figures show. */
export enum AllocationFailureReason {
    NOT_ENOUGH_FREE_SPACE = 'not_enough_free_space',
    FRAGMENTED = 'fragmented',
    FREE_BLOCK_COULD_HOLD_IT = 'free_block_could_hold_it',
    LARGER_THAN_EMPTY_BANK = 'larger_than_empty_bank',
    BEYOND_END_OF_L1 = 'beyond_end_of_l1',
    OVERLAPS_L1_BUFFER = 'overlaps_l1_buffer',
}

// `docs/src/allocation-failures.md` uses these as its headings; keep the two in step.
export const ALLOCATION_FAILURE_REASON_LABELS: Record<AllocationFailureReason, string> = {
    [AllocationFailureReason.NOT_ENOUGH_FREE_SPACE]: 'Not enough free space',
    [AllocationFailureReason.FRAGMENTED]: 'Fragmented',
    [AllocationFailureReason.FREE_BLOCK_COULD_HOLD_IT]: 'A free block could hold it',
    [AllocationFailureReason.LARGER_THAN_EMPTY_BANK]: 'Larger than an empty bank',
    [AllocationFailureReason.BEYOND_END_OF_L1]: 'Beyond the end of L1',
    [AllocationFailureReason.OVERLAPS_L1_BUFFER]: 'Overlaps an L1 buffer',
};

// Enough to show a pattern without pushing the table below the fold; a run usually
// stops at its first failure, so a longer list means the script caught and retried.
export const MAX_ALLOCATION_FAILURES_LISTED = 5;
