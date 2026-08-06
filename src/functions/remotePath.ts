// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Mirrors sanitise_remote_report_path in backend/ttnn_visualizer/models.py. The backend
// is the boundary that matters — these paths are interpolated into remote shell commands
// — but repeating the rule here turns a 400 from the connection test into a message
// against the offending field while the user is still typing.

// Linux PATH_MAX, matching MAX_REMOTE_PATH_LENGTH on the backend.
export const MAX_REMOTE_PATH_LENGTH = 4096;

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
export function getRemotePathError(path: string | undefined | null): string | null {
    const trimmed = (path ?? '').trim();

    if (trimmed === '') {
        return null;
    }

    if (hasControlCharacters(trimmed)) {
        return 'Path must not contain line breaks or other control characters.';
    }

    if (!trimmed.startsWith('/')) {
        // `~` is called out because it looks like it should work: it reaches the remote
        // host quoted, so no shell expands it and discovery silently finds nothing.
        return 'Path must be absolute, starting with "/". Home-relative paths such as "~/tt-metal" are not expanded.';
    }

    if (trimmed.length > MAX_REMOTE_PATH_LENGTH) {
        return `Path must be at most ${MAX_REMOTE_PATH_LENGTH} characters.`;
    }

    return null;
}

export function isValidRemotePath(path: string | undefined | null): boolean {
    return getRemotePathError(path) === null;
}
