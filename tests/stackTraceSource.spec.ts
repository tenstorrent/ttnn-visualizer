// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    extractOperationSourceData,
    getCallSiteFrame,
    getFrameSourceFileId,
    isFrameSourceInReport,
    parseStackTraceFrames,
} from '../src/functions/stackTraceSource';

const PYTHON_TRACE =
    'File "/models/resnet/ttnn_functional_resnet50.py", line 641, in forward\n    return ttnn.matmul(a, b)';

// Blank lines between frames, as the capture writes them: innermost (the call site) first.
const MULTI_FRAME_TRACE = [
    '  File "/m/models/resnet.py", line 135, in run_downsample_if_req',
    '    ds_out = ttnn.conv2d(',
    '',
    '  File "/m/tests/infra.py", line 317, in run',
    '    self.output = self.model(',
].join('\n');

describe('parseStackTraceFrames', () => {
    it('reads every frame of a trace with blank lines between frames', () => {
        expect(parseStackTraceFrames(MULTI_FRAME_TRACE)).toEqual([
            {
                index: 0,
                lineIndex: 0,
                file: '/m/models/resnet.py',
                line: 135,
                prefix: '  File ',
                suffix: ', in run_downsample_if_req',
                function: 'run_downsample_if_req',
            },
            {
                index: 1,
                lineIndex: 3,
                file: '/m/tests/infra.py',
                line: 317,
                prefix: '  File ',
                suffix: ', in run',
                function: 'run',
            },
        ]);
    });

    it('reads frames on adjacent lines', () => {
        const trace = '  File "/m/outer.py", line 1, in outer\n  File "/m/inner.py", line 2, in inner\n    x()';

        expect(parseStackTraceFrames(trace).map(({ file, line, lineIndex }) => [file, line, lineIndex])).toEqual([
            ['/m/outer.py', 1, 0],
            ['/m/inner.py', 2, 1],
        ]);
    });

    it('skips a File line with no line number, never pairing it with the next frame', () => {
        const trace = '  File "/m/partial.py"\n  File "/m/real.py", line 7, in fn\n    x()';

        expect(parseStackTraceFrames(trace).map(({ index, file, line }) => [index, file, line])).toEqual([
            [0, '/m/real.py', 7],
        ]);
        expect(getCallSiteFrame(trace)).toMatchObject({ file: '/m/real.py', line: 7 });
    });

    it('reads a path with a quote in it as no frame', () => {
        expect(parseStackTraceFrames('  File "/m/we"ird.py", line 20, in f\n    x()')).toEqual([]);
    });

    it('reads CRLF traces without carrying the carriage return', () => {
        const frames = parseStackTraceFrames(MULTI_FRAME_TRACE.replace(/\n/g, '\r\n'));

        expect(frames.map(({ lineIndex, suffix }) => [lineIndex, suffix])).toEqual([
            [0, ', in run_downsample_if_req'],
            [3, ', in run'],
        ]);
    });

    it('reads no frame from a line that only quotes one', () => {
        expect(parseStackTraceFrames(`    raise ValueError('File "/a.py", line 3, in f')`)).toEqual([]);
    });

    it('reads nothing from a trace that is not a Python traceback', () => {
        expect(parseStackTraceFrames('#0 0x7f in ttnn::run()')).toEqual([]);
        expect(parseStackTraceFrames('')).toEqual([]);
    });

    it('reads no frames from the null the operations endpoint sends for an untraced operation', () => {
        // The model types `stack_trace` as a string; the serializer can send null.
        const untraced = null as unknown as string;

        expect(parseStackTraceFrames(untraced)).toEqual([]);
        expect(extractOperationSourceData({ stack_trace: untraced, stack_trace_source_file_id: null })).toBeNull();
    });
});

describe('getCallSiteFrame', () => {
    it("returns frame 0's file, line and function from a multi-frame trace", () => {
        expect(getCallSiteFrame(MULTI_FRAME_TRACE)).toMatchObject({
            index: 0,
            file: '/m/models/resnet.py',
            line: 135,
            function: 'run_downsample_if_req',
        });
    });

    it('trims whitespace around the function name, as the backend strips it', () => {
        expect(getCallSiteFrame('  File "/m/a.py", line 3, in forward  \n    x()')?.function).toBe('forward');
    });

    it('returns null when the trace has no frame', () => {
        expect(getCallSiteFrame('#0 0x7f in ttnn::run()')).toBeNull();
        expect(getCallSiteFrame('')).toBeNull();
        expect(getCallSiteFrame('  File "/m/we"ird.py", line 20, in f\n    x()')).toBeNull();
        expect(getCallSiteFrame(null as unknown as string)).toBeNull();
    });

    it.each([
        ['a multi-frame trace', MULTI_FRAME_TRACE],
        ['a CRLF trace', MULTI_FRAME_TRACE.replace(/\n/g, '\r\n')],
        ['a CR-only trace', MULTI_FRAME_TRACE.replace(/\n/g, '\r')],
        ['a frame after a partial File line', '  File "/m/partial.py"\n  File "/m/real.py", line 7, in fn\n    x()'],
        ['a frame after leading blank lines', '\n\r\n  File "/m/late.py", line 9, in late'],
        ['a trace ending in a line break', '  File "/m/end.py", line 4, in end\n'],
        ['a one-line trace', PYTHON_TRACE],
        ['a trace with no frame', 'no frame here'],
    ])('agrees with the first frame parseStackTraceFrames reads, on %s', (_, trace) => {
        expect(getCallSiteFrame(trace)).toEqual(parseStackTraceFrames(trace)[0] ?? null);
    });
});

describe('getFrameSourceFileId', () => {
    it("passes the report's source file id to frame 0 only", () => {
        const [callSite, caller] = parseStackTraceFrames(MULTI_FRAME_TRACE);

        expect(getFrameSourceFileId(callSite, 7)).toBe(7);
        expect(getFrameSourceFileId(caller, 7)).toBeNull();
        expect(getFrameSourceFileId(callSite, null)).toBeNull();
    });
});

describe('isFrameSourceInReport', () => {
    const [callSite, caller] = parseStackTraceFrames(MULTI_FRAME_TRACE);
    const holding = (ids: number[], paths: string[]) => ({ ids: new Set(ids), paths: new Set(paths) });

    it('holds a frame whose path the report lists', () => {
        expect(isFrameSourceInReport(caller, null, holding([], ['/m/tests/infra.py']))).toBe(true);
    });

    it("holds frame 0 by the trace's source file id, and no other frame by it", () => {
        expect(isFrameSourceInReport(callSite, 7, holding([7], []))).toBe(true);
        expect(isFrameSourceInReport(caller, 7, holding([7], []))).toBe(false);
    });

    it('does not hold a frame by an id the report does not list', () => {
        expect(isFrameSourceInReport(callSite, 7, holding([8], []))).toBe(false);
    });
});

describe('getCallSiteFrame on a single frame or none', () => {
    it("reads a single frame's file and line", () => {
        expect(getCallSiteFrame(PYTHON_TRACE)).toMatchObject({
            file: '/models/resnet/ttnn_functional_resnet50.py',
            line: 641,
        });
    });

    it('is null when no line is a whole frame', () => {
        expect(getCallSiteFrame('no file here')).toBeNull();
        expect(getCallSiteFrame('File "/x.py" with no line')).toBeNull();
        expect(getCallSiteFrame('')).toBeNull();
    });
});

describe('extractOperationSourceData', () => {
    it('returns file path and line number when the trace has both', () => {
        expect(
            extractOperationSourceData({
                stack_trace: PYTHON_TRACE,
                stack_trace_source_file_id: null,
            }),
        ).toEqual({
            filePath: '/models/resnet/ttnn_functional_resnet50.py',
            lineNumber: 641,
        });
    });

    it('returns source data when only a source file id is present', () => {
        expect(
            extractOperationSourceData({
                stack_trace: '',
                stack_trace_source_file_id: 7,
            }),
        ).toEqual({
            filePath: '',
            lineNumber: null,
        });
    });

    it('returns null when there is neither a file path nor a source file id', () => {
        expect(
            extractOperationSourceData({
                stack_trace: '',
                stack_trace_source_file_id: null,
            }),
        ).toBeNull();
    });
});
