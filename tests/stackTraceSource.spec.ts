// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    extractOperationSourceData,
    getStackTraceFilePath,
    getStackTraceLineNumber,
} from '../src/functions/stackTraceSource';

const PYTHON_TRACE =
    'File "/models/resnet/ttnn_functional_resnet50.py", line 641, in forward\n    return ttnn.matmul(a, b)';

describe('getStackTraceFilePath', () => {
    it('extracts the file path from a trace', () => {
        expect(getStackTraceFilePath(PYTHON_TRACE)).toBe('/models/resnet/ttnn_functional_resnet50.py');
    });

    it('returns an empty string when no file path is present', () => {
        expect(getStackTraceFilePath('no file here')).toBe('');
        expect(getStackTraceFilePath('')).toBe('');
    });
});

describe('getStackTraceLineNumber', () => {
    it('extracts the line number from a trace', () => {
        expect(getStackTraceLineNumber(PYTHON_TRACE)).toBe(641);
    });

    it('returns null when no line number is present', () => {
        expect(getStackTraceLineNumber('File "/x.py" with no line')).toBeNull();
        expect(getStackTraceLineNumber('')).toBeNull();
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
