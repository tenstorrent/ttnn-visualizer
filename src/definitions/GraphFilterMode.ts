// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// String-backed so the member values match the historical `sessionStorage`
// payload ('substring' / 'regex'); persisted state migrates without a version
// bump, and the MLIR and operation-graph views can share one storage vocabulary.
export enum GraphFilterMode {
    SUBSTRING = 'substring',
    REGEX = 'regex',
}
