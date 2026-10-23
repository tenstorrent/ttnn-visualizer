// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum FolderLinkState {
    LINKED = 'linked',
    UNLINKED = 'unlinked',
    UNKNOWN = 'unknown',
}

// Report picker filter copy, shared by both pickers and their tests.
export const LINKED_ONLY_LABEL = 'Show linked reports only';
export const NO_LINKED_RESULTS_TEXT = 'No linked reports.';
// Blueprint's own wording for the clear button the picker's filter actions replace.
export const CLEAR_FILTER_QUERY_LABEL = 'Clear filter query';
