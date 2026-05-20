// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum StackTraceLanguage {
    PYTHON = 'python',
    CPP = 'cpp',
}

export enum SourceFileStatus {
    Unavailable = 'unavailable',
    Pending = 'pending',
    Available = 'available',
}

/** Values returned by ``GET /api/remote/stack-trace/test`` in the ``source`` field. */
export enum StackSourceOrigin {
    Database = 'database',
    Path = 'path',
    Remapped = 'remapped',
}
