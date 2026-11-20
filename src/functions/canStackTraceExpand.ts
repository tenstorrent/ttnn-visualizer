// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { splitStackTraceLines } from './stackTraceSource';

// How many lines a collapsed `StackTrace` shows.
export const STACK_TRACE_PREVIEW_LINES = 2;

/**
 * Whether a `StackTrace` showing this text renders an Expand button: only when it has more
 * lines than the preview. Lines are split as `StackTrace` renders them, so a trailing line
 * break is a line of its own and CRLF counts once.
 */
export default function canStackTraceExpand(stackTrace: string): boolean {
    return splitStackTraceLines(stackTrace).length > STACK_TRACE_PREVIEW_LINES;
}
