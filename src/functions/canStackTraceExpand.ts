// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// How many lines a collapsed `StackTrace` shows.
export const STACK_TRACE_PREVIEW_LINES = 2;

/**
 * Whether a `StackTrace` showing this text renders an Expand button: only when it has more
 * lines than the preview. Lines are counted as `StackTrace` numbers them, by every `^` in
 * multiline mode, which highlighting leaves unchanged since it adds no line breaks.
 */
export default function canStackTraceExpand(stackTrace: string): boolean {
    return (stackTrace.match(/^/gm)?.length ?? 0) > STACK_TRACE_PREVIEW_LINES;
}
