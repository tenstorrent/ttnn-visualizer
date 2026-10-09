// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The default branch of an exhaustive `switch`: a new member of the union fails to compile at
 * every call site until it is handled. Reaching it at runtime means a value arrived that the
 * types ruled out, which is a bug rather than input to recover from.
 */
const assertNever = (value: never): never => {
    throw new Error(`Unhandled value: ${JSON.stringify(value)}`);
};

export default assertNever;
