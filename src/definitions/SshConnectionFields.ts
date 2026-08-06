// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Copy for the SSH fields both connection dialogs present — remote connections and MLIR servers
 * take the same SSH target, so the two dialogs must describe it identically or the same field
 * appears to behave differently depending on where it is reached from.
 */

export const SSH_USERNAME_SUBLABEL = 'Username to connect with (overrides SSH config User)';

export const SSH_HOST_SUBLABEL = 'SSH host alias or hostname (e.g. work-gpu or localhost)';

/**
 * The MLIR variant deliberately differs: that flow SSHes to the host and then probes the MLIR
 * server on *that* machine's loopback, so localhost names this machine and is rejected outright
 * by the dialog. Both live here so the divergence is visible rather than looking like drift.
 */
export const MLIR_SSH_HOST_SUBLABEL =
    'Machine you SSH into (not localhost — use the remote hostname or SSH config alias)';

/** Accessible name for the identity input; both dialogs and their tests address it by this. */
export const SSH_IDENTITY_FILE_LABEL = 'SSH identity file (optional)';

/**
 * Describes what OpenSSH actually does with the field, so it has to stay in step with the identity
 * file section of `docs/src/remote-sync.md` and with `SSHClient`, which passes `-F /dev/null` and
 * `IdentitiesOnly=yes` once a path is set.
 */
export const SSH_IDENTITY_FILE_SUBLABEL =
    'Path to your private key. Leave empty to use SSH defaults / ~/.ssh/config for this host. Setting a path ignores SSH config for this connection.';

export const SSH_IDENTITY_FILE_PLACEHOLDER = 'Leave empty for default / SSH config';

/**
 * The report-path rule, and the copy explaining each way of breaking it.
 *
 * Kept beside the limit the message quotes, and shared with the tests that assert it, so a
 * reworded message cannot pass a spec matching the old wording. The rule itself is enforced
 * by `getRemotePathError` and mirrored by `sanitise_remote_report_path` on the backend.
 */

/** Linux PATH_MAX, matching MAX_REMOTE_PATH_LENGTH on the backend. */
export const MAX_REMOTE_PATH_LENGTH = 4096;

export const REMOTE_PATH_NOT_TEXT_ERROR = 'Path must be text.';

export const REMOTE_PATH_CONTROL_CHARACTERS_ERROR = 'Path must not contain line breaks or other control characters.';

/**
 * `~` is called out because it looks like it should work: it reaches the remote host quoted, so
 * no shell expands it and discovery silently finds nothing.
 */
export const REMOTE_PATH_NOT_ABSOLUTE_ERROR =
    'Path must be absolute, starting with "/". Home-relative paths such as "~/tt-metal" are not expanded.';

export const REMOTE_PATH_TOO_LONG_ERROR = `Path must be at most ${MAX_REMOTE_PATH_LENGTH} characters.`;

/**
 * Ids for the elements carrying a path field's error, referenced by the inputs' `aria-describedby`.
 * Blueprint renders `helperText` into an unlabelled div, so the association is ours to make.
 */
export const REMOTE_MEMORY_PATH_ERROR_ID = 'remote-memory-path-error';

export const REMOTE_PERFORMANCE_PATH_ERROR_ID = 'remote-performance-path-error';
