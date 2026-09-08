// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export const TARGET_DB_VERSION_MAX = 3;
export const TARGET_DB_VERSION_MIN = 0;

export enum DBVersionValidation {
    OK,
    DB_OLD,
    DB_NEW,
}

/** Severity of how far the running app trails the latest published release. Ordered, so `> NONE` means an update is available. */
export enum OutdatedLevel {
    NONE = 0,
    ONE = 1,
    TWO = 2,
    THREE = 3,
}
