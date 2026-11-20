// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Operation, ReportSourceFiles } from '../model/APIData';

// One frame of a Python traceback, the same shape as `_TRACE_FRAME` in
// `backend/ttnn_visualizer/agent/operations.py` so the operation details panel and the MCP
// tools name the same call site. Anchored to one line, so a frame's file and line number can
// never come from two different frames, and `[^"]*` cannot span a quote, so a path it cannot
// delimit is no frame rather than a wrong one. `TestFrameParity` holds the two in step.
const TRACE_FRAME_REGEX = /^([ \t]*File )"([^"]*)", line (\d+)(, in .*)$/;

// `.` never matches a line terminator, so the frame pattern is applied per line and CRLF
// traces split here rather than leaving a `\r` on the end of every line.
const LINE_BREAK_REGEX = /\r\n|\r|\n/;

type OperationStackTraceFields = Pick<Operation, 'stack_trace' | 'stack_trace_source_file_id'>;

export interface OperationSourceData {
    filePath: string;
    lineNumber: number | null;
}

export interface StackTraceFrame {
    // Position among the trace's frames: 0 is the innermost, the `ttnn.<op>` call site.
    index: number;
    // Position among the trace's lines, as `splitStackTraceLines` returns them.
    lineIndex: number;
    file: string;
    line: number;
    // The line's text either side of `"<file>", line <line>`.
    prefix: string;
    suffix: string;
    // The suffix's name after `, in `, trimmed as `parse_frames` strips it.
    function: string;
}

const FRAME_FUNCTION_PREFIX = ', in ';

const toStackTraceFrame = (match: RegExpExecArray, index: number, lineIndex: number): StackTraceFrame => ({
    index,
    lineIndex,
    file: match[2],
    line: parseInt(match[3], 10),
    prefix: match[1],
    suffix: match[4],
    function: match[4].slice(FRAME_FUNCTION_PREFIX.length).trim(),
});

export const splitStackTraceLines = (stackTrace: string): string[] => stackTrace.split(LINE_BREAK_REGEX);

// `stackTrace` is typed `string`, but the operations endpoint sends `null` for an operation
// with no captured trace, which reads as no frames rather than a crash in render.
export const parseStackTraceFrames = (stackTrace: string): StackTraceFrame[] => {
    const frames: StackTraceFrame[] = [];

    if (typeof stackTrace !== 'string') {
        return frames;
    }

    splitStackTraceLines(stackTrace).forEach((text, lineIndex) => {
        const match = TRACE_FRAME_REGEX.exec(text);

        if (match) {
            frames.push(toStackTraceFrame(match, frames.length, lineIndex));
        }
    });

    return frames;
};

/**
 * Frame 0, the `ttnn.<op>` call site, or `null` when the trace has no frame. The same frame
 * `parseStackTraceFrames(stackTrace)[0]` returns, but read one line at a time and stopping
 * there: traces average about 7 KB, and grouping a performance report by call site reads every
 * operation's, so splitting and matching every line of each would be wasted.
 */
export const getCallSiteFrame = (stackTrace: string): StackTraceFrame | null => {
    if (typeof stackTrace !== 'string') {
        return null;
    }

    // A fresh global copy per call, so `lastIndex` is never shared between callers. It breaks
    // lines exactly where `splitStackTraceLines` does, so `lineIndex` agrees with it.
    const lineBreak = new RegExp(LINE_BREAK_REGEX.source, 'g');
    let lineStart = 0;

    for (let lineIndex = 0; ; lineIndex++) {
        const lineBreakMatch = lineBreak.exec(stackTrace);
        const lineEnd = lineBreakMatch ? lineBreakMatch.index : stackTrace.length;
        const match = TRACE_FRAME_REGEX.exec(stackTrace.slice(lineStart, lineEnd));

        if (match) {
            return toStackTraceFrame(match, 0, lineIndex);
        }

        if (!lineBreakMatch) {
            return null;
        }

        lineStart = lineBreak.lastIndex;
    }
};

/**
 * The report's source file id for a frame. `stack_traces.source_file_id` is one id per trace,
 * for frame 0's file: tt-metal's writer stores the first file the trace names
 * (`extract_stack_trace_file` in `ttnn/ttnn/stack_trace_source.py`). The backend tries the id
 * before the path, so sending it with any other frame's path would open frame 0's file instead.
 */
export const getFrameSourceFileId = (frame: StackTraceFrame, sourceFileId: number | null): number | null =>
    frame.index === 0 ? sourceFileId : null;

/**
 * Whether the report holds a frame's source file, by path or, for frame 0 only, by the
 * trace's source file id. Frame links are limited to these files; see `StackTraceFrameLine`.
 */
export const isFrameSourceInReport = (
    frame: StackTraceFrame,
    sourceFileId: number | null,
    sourceFiles: ReportSourceFiles,
): boolean => {
    const frameSourceFileId = getFrameSourceFileId(frame, sourceFileId);

    return sourceFiles.paths.has(frame.file) || (frameSourceFileId != null && sourceFiles.ids.has(frameSourceFileId));
};

export const extractOperationSourceData = (operation: OperationStackTraceFields): OperationSourceData | null => {
    const callSite = getCallSiteFrame(operation.stack_trace);
    const filePath = callSite?.file ?? '';
    const hasSource = !!filePath || operation.stack_trace_source_file_id != null;

    if (!hasSource) {
        return null;
    }

    return {
        filePath,
        lineNumber: callSite?.line ?? null,
    };
};
