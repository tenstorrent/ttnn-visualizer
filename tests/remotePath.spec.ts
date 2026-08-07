// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { describe, expect, it } from 'vitest';
import {
    MAX_REMOTE_PATH_LENGTH,
    REMOTE_PATH_CONTROL_CHARACTERS_ERROR,
    REMOTE_PATH_NOT_ABSOLUTE_ERROR,
    REMOTE_PATH_NOT_TEXT_ERROR,
    REMOTE_PATH_TOO_LONG_ERROR,
} from '../src/definitions/SshConnectionFields';
import { getRemoteConnectionPathError, getRemotePathError, isValidRemotePath } from '../src/functions/remotePath';

describe('getRemotePathError', () => {
    it('accepts an absolute path', () => {
        expect(getRemotePathError('/home/user/tt-metal/generated/ttnn/reports')).toBeNull();
    });

    it('accepts a trailing slash, which the backend preserves', () => {
        expect(getRemotePathError('/reports/')).toBeNull();
    });

    // An unconfigured path is a supported state, not an error: report discovery skips a
    // path it was not given, so the field must not go red merely for being empty.
    it.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['undefined', undefined],
        ['null', null],
    ])('treats an unconfigured path (%s) as valid', (_label, path) => {
        expect(getRemotePathError(path)).toBeNull();
    });

    it.each([
        ['bare', 'reports'],
        ['relative', 'tt-metal/generated/ttnn/reports'],
        ['dot-relative', './reports'],
    ])('rejects a path that is not absolute (%s)', (_label, path) => {
        expect(getRemotePathError(path)).toBe(REMOTE_PATH_NOT_ABSOLUTE_ERROR);
    });

    // Called out separately because a tilde path looks like it should work: it reaches
    // the remote host quoted, so nothing expands it and discovery silently finds nothing.
    it('names home-relative paths explicitly', () => {
        expect(getRemotePathError('~/tt-metal/generated/ttnn/reports')).toMatch(/~\/tt-metal/);
    });

    it.each([
        ['newline', '/reports\nrm -rf /'],
        ['carriage return', '/reports\rls'],
        ['nul', '/reports\u0000/etc'],
        ['tab', '/reports\treports'],
        ['delete', '/reports\u007f'],
    ])('rejects control characters (%s)', (_label, path) => {
        expect(getRemotePathError(path)).toBe(REMOTE_PATH_CONTROL_CHARACTERS_ERROR);
    });

    it('rejects a path longer than the backend limit', () => {
        expect(getRemotePathError(`/${'a'.repeat(MAX_REMOTE_PATH_LENGTH)}`)).toBe(REMOTE_PATH_TOO_LONG_ERROR);
        expect(REMOTE_PATH_TOO_LONG_ERROR).toContain(String(MAX_REMOTE_PATH_LENGTH));
    });

    it('accepts a path at exactly the limit', () => {
        expect(getRemotePathError(`/${'a'.repeat(MAX_REMOTE_PATH_LENGTH - 1)}`)).toBeNull();
    });

    // Quoting on the backend, not validation, is what makes these safe, so they must not
    // be rejected here — a real report folder is allowed to contain odd characters.
    it.each([
        ['space', '/a path/reports'],
        ['apostrophe', "/remote/o'brien/reports"],
        ['semicolon', '/reports; touch /tmp/pwned'],
    ])('accepts an absolute path containing shell metacharacters (%s)', (_label, path) => {
        expect(getRemotePathError(path)).toBeNull();
    });

    it('trims before validating', () => {
        expect(getRemotePathError('  /reports  ')).toBeNull();
        expect(getRemotePathError('  reports  ')).toBe(REMOTE_PATH_NOT_ABSOLUTE_ERROR);
    });

    // Callers include a getter over JSON.parse'd localStorage, and the connection-list
    // getter runs inside a useState initialiser — a throw there is a blank page, not a
    // filtered-out row.
    it.each([
        ['number', 42],
        ['object', { path: '/reports' }],
        ['array', ['/reports']],
        ['boolean', true],
    ])('rejects a non-string path (%s) rather than throwing', (_label, path) => {
        expect(getRemotePathError(path)).toBe(REMOTE_PATH_NOT_TEXT_ERROR);
    });
});

describe('isValidRemotePath', () => {
    it('mirrors getRemotePathError', () => {
        expect(isValidRemotePath('/reports')).toBe(true);
        expect(isValidRemotePath('reports')).toBe(false);
        expect(isValidRemotePath(undefined)).toBe(true);
    });
});

describe('getRemoteConnectionPathError', () => {
    it('accepts a connection whose configured paths are absolute', () => {
        expect(getRemoteConnectionPathError({ profilerPath: '/mem', performancePath: '/perf' })).toBeNull();
    });

    it('accepts a connection with only one path configured', () => {
        expect(getRemoteConnectionPathError({ profilerPath: '/mem' })).toBeNull();
    });

    it.each([
        ['profiler', { profilerPath: 'reports', performancePath: '/perf' }],
        ['performance', { profilerPath: '/mem', performancePath: 'reports' }],
    ])('reports whichever path (%s) the server would refuse', (_label, connection) => {
        expect(getRemoteConnectionPathError(connection)).toBe(REMOTE_PATH_NOT_ABSOLUTE_ERROR);
    });
});
