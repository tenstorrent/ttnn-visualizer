// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import canStackTraceExpand from '../src/functions/canStackTraceExpand';

describe('canStackTraceExpand', () => {
    it.each([
        ['an empty trace', '', false],
        ['one line', 'frame 0', false],
        ['two lines, the whole preview', 'frame 0\nframe 1', false],
        ['three lines', 'frame 0\nframe 1\nframe 2', true],
        // Counted as `StackTrace` renders lines, so a trailing newline is a line of its own.
        ['two lines and a trailing newline', 'frame 0\nframe 1\n', true],
        ['two CRLF lines, the whole preview', 'frame 0\r\nframe 1', false],
    ])('says whether %s can expand', (_case, trace, expected) => {
        expect(canStackTraceExpand(trace)).toBe(expected);
    });
});
