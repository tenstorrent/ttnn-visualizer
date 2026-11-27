// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Operation, ReportSourceFiles } from '../model/APIData';
import { getPathBasename } from './formatting';

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

export const parseStackTraceFrames = (stackTrace: string): StackTraceFrame[] => {
    const frames: StackTraceFrame[] = [];

    splitStackTraceLines(stackTrace).forEach((text, lineIndex) => {
        const match = TRACE_FRAME_REGEX.exec(text);

        if (match) {
            frames.push(toStackTraceFrame(match, frames.length, lineIndex));
        }
    });

    return frames;
};

/**
 * Frame 0, the `ttnn.<op>` call site, or `null` when there is no trace or it has no frame. The
 * same frame `parseStackTraceFrames(stackTrace)[0]` returns, but read one line at a time and
 * stopping there: traces average about 7 KB, and grouping a performance report by call site reads
 * every operation's, so splitting and matching every line of each would be wasted.
 */
export const getCallSiteFrame = (stackTrace: string | null): StackTraceFrame | null => {
    if (stackTrace === null) {
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
 * `<basename>:<line>` of a frame, or `''` when it names no file (an empty or slash-terminated
 * path). The operations list and the Stacked view's source-line groups both label a call site
 * with it, so the two cannot drift apart.
 */
export const formatFrameLabel = (frame: Pick<StackTraceFrame, 'file' | 'line'>): string => {
    const fileName = getPathBasename(frame.file);

    return fileName ? `${fileName}:${frame.line}` : '';
};

/**
 * `formatFrameLabel` of the call site, the frame the Source button opens, or `''` when there is
 * no trace or it has no frame. Read through `getCallSiteFrame` so the label can never name a
 * different frame from the one `extractOperationSourceData` links to.
 */
export const getOperationFileIdentifier = (stackTrace: string | null): string => {
    const callSite = getCallSiteFrame(stackTrace);

    return callSite ? formatFrameLabel(callSite) : '';
};

/**
 * The report's source file id for a frame. `stack_traces.source_file_id` is one id per trace,
 * for frame 0's file: tt-metal's writer stores the first file the trace names
 * (`extract_stack_trace_file` in `ttnn/ttnn/stack_trace_source.py`). The backend tries the id
 * before the path, so any other frame sends its own file's id instead: the one the report maps
 * its path to, by stored path or by a raw path other traces were stored with, or none.
 *
 * Frame 0 falls back to that mapping too when the trace has no id, or one the report does not
 * list: the backend would then look the path up exactly, and an alias is no stored path, so the
 * file `isFrameSourceInReport` linked it by would open as not found.
 */
export const getFrameSourceFileId = (
    frame: StackTraceFrame,
    sourceFileId: number | null,
    sourceFiles: ReportSourceFiles | undefined,
): number | null => {
    const mappedId = sourceFiles?.idsByPath.get(frame.file) ?? null;

    if (frame.index !== 0) {
        return mappedId;
    }

    if (sourceFileId != null && (!sourceFiles || sourceFiles.ids.has(sourceFileId))) {
        return sourceFileId;
    }

    return mappedId ?? sourceFileId;
};

/**
 * Whether the report holds a frame's source file, by a path it maps to a file or, for frame 0
 * only, by the trace's source file id. Frame links are limited to these files; see
 * `StackTraceFrameLine`.
 */
export const isFrameSourceInReport = (
    frame: StackTraceFrame,
    sourceFileId: number | null,
    sourceFiles: ReportSourceFiles,
): boolean => {
    const callSiteSourceFileId = frame.index === 0 ? sourceFileId : null;

    return (
        sourceFiles.idsByPath.has(frame.file) ||
        (callSiteSourceFileId != null && sourceFiles.ids.has(callSiteSourceFileId))
    );
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
