// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum StackTraceLanguage {
    PYTHON = 'python',
    CPP = 'cpp',
}

export enum SourceFileStatus {
    Unknown = 'unknown',
    Unavailable = 'unavailable',
    Pending = 'pending',
    Available = 'available',
}

export enum StackSourceOrigin {
    Database = 'database',
    Path = 'path',
    Remapped = 'remapped',
}
