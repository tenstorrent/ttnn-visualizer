// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * The leaf of an op name, whichever separator the report spelled it with.
 *
 * Reports arrive in both spellings — `DEALLOCATE_OP_NAME_LIST` enumerates
 * `ttnn.deallocate` and `ttnn::deallocate` for exactly that reason — so a rule that
 * knows only one of them silently stops matching on half the corpus. #1990
 *
 * Not to be confused with matching a *whole* name: `isDeallocate` compares the full
 * name because `Tensor::deallocate` is a different op that shares this leaf.
 */
export const shortOperationName = (name: string): string => {
    const trimmed = name.trim();
    if (!trimmed) {
        return '';
    }
    const parts = trimmed.split(/::|\./);
    return parts[parts.length - 1] || trimmed;
};
