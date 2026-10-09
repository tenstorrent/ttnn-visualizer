// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** How a function scope in a captured graph ended. */
export enum ScopeOutcome {
    COMPLETED = 'completed',
    FAILED = 'failed',
    // Left open with no recorded error: a capture that stopped part way.
    UNCLOSED = 'unclosed',
}
