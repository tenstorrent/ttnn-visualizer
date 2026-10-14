// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** How a likely L1-to-DRAM fallback was inferred. tt-metal records none of them. */
export enum DramFallbackSignal {
    ARGUMENT_MISMATCH = 'argument_mismatch',
    RETRY_AFTER_FAILURE = 'retry_after_failure',
}

// A script's `try`/`except` retry is usually the next call, but a conversion op can sit
// between the two. A judgement, not a measurement: no report to hand contains a retry.
export const DRAM_FALLBACK_RETRY_WINDOW_OPERATIONS = 3;

// An L1 intermediate says nothing about where the output should go, so an op given only
// that legitimately writes its output to the default DRAM.
export const DRAM_FALLBACK_IGNORED_ARGUMENT_PATTERN = /intermediate/;
