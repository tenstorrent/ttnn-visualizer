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
