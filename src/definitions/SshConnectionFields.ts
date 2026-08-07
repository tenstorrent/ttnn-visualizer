// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Copy for the SSH fields both connection dialogs present — remote connections and MLIR servers
 * take the same SSH target, so the two dialogs must describe it identically or the same field
 * appears to behave differently depending on where it is reached from.
 */
/** Accessible names for the SSH fields; both dialogs and their tests address them by these. */
export const SSH_HOST_LABEL = 'SSH Host';

export const SSH_USERNAME_LABEL = 'SSH Username';

export const SSH_PORT_LABEL = 'SSH Port';

export const SSH_HOST_SUBLABEL = 'SSH host alias or hostname (e.g. work-gpu or localhost)';

/** Accessible name for the identity input; both dialogs and their tests address it by this. */
export const SSH_IDENTITY_FILE_LABEL = 'SSH Identity File (optional)';

/**
 * Describes what OpenSSH actually does with the field, so it has to stay in step with the identity
 * file section of `docs/src/remote-sync.md` and with `SSHClient`, which passes `-F /dev/null` and
 * `IdentitiesOnly=yes` once a path is set.
 */
export const SSH_IDENTITY_FILE_SUBLABEL =
    'Path to your private key. Setting a path ignores SSH config for this connection.';

export const SSH_IDENTITY_FILE_PLACEHOLDER = 'Leave empty for default / SSH config';

/**
 * Highest port a TCP connection can reach, shared so the dialogs and the server config validation
 * can't disagree about what a port may be. A digit-by-digit field stays typable under this bound
 * because every prefix of a legal port is itself a legal port.
 */
export const MAX_PORT = 65535;
