// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Mirrors sanitise_remote_report_path in backend/ttnn_visualizer/models.py. The backend
// is the boundary that matters — these paths are interpolated into remote shell commands
// — but repeating the rule here turns a 400 from the connection test into a message
// against the offending field while the user is still typing.

import {
    MAX_REMOTE_PATH_LENGTH,
    REMOTE_PATH_CONTROL_CHARACTERS_ERROR,
    REMOTE_PATH_NOT_ABSOLUTE_ERROR,
    REMOTE_PATH_NOT_TEXT_ERROR,
    REMOTE_PATH_TOO_LONG_ERROR,
} from '../definitions/SshConnectionFields';

const UNIT_SEPARATOR_CODE_POINT = 0x1f;
const DELETE_CODE_POINT = 0x7f;

// Compared by code point rather than by regex: a character class covering C0 would trip
// no-control-regex, and this mirrors how the backend validator iterates the string.
function hasControlCharacters(value: string): boolean {
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;

        if (codePoint <= UNIT_SEPARATOR_CODE_POINT || codePoint === DELETE_CODE_POINT) {
            return true;
        }
    }

    return false;
}

/**
 * Why `path` is not a usable remote report folder, or null when it is.
 *
 * An empty path is valid: it means the folder is not configured, and report discovery
 * skips a path it was not given.
 */
export function getRemotePathError(path: unknown): string | null {
    // Callers include a getter over JSON.parse'd localStorage, so a non-string can
    // arrive: typed as unknown rather than string so a `.trim()` on corrupted data
    // can't throw out of a render.
    if (path === undefined || path === null || path === '') {
        return null;
    }

    if (typeof path !== 'string') {
        return REMOTE_PATH_NOT_TEXT_ERROR;
    }

    const trimmed = path.trim();

    if (trimmed === '') {
        return null;
    }

    if (trimmed.length > MAX_REMOTE_PATH_LENGTH) {
        // Checked before scanning for control characters so an oversized paste is
        // rejected on its length rather than walked in full first.
        return REMOTE_PATH_TOO_LONG_ERROR;
    }

    if (hasControlCharacters(trimmed)) {
        return REMOTE_PATH_CONTROL_CHARACTERS_ERROR;
    }

    if (!trimmed.startsWith('/')) {
        return REMOTE_PATH_NOT_ABSOLUTE_ERROR;
    }

    return null;
}

export function isValidRemotePath(path: unknown): boolean {
    return getRemotePathError(path) === null;
}

/**
 * Why a saved connection's report paths would be refused by the server, or null.
 *
 * Such a connection is kept in the list rather than filtered out of it: it was
 * storable before the paths were validated, and dropping it on read would erase
 * it from storage on the next write with nothing telling the user why.
 */
export function getRemoteConnectionPathError(connection: {
    profilerPath?: unknown;
    performancePath?: unknown;
}): string | null {
    return getRemotePathError(connection.profilerPath) ?? getRemotePathError(connection.performancePath);
}
