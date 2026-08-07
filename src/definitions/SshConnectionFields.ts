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
 * Upper bound the port inputs reject beyond, shared so the two dialogs can't disagree about what
 * a typed port may be. Deliberately looser than the 65535 a TCP port can reach: the field is
 * digit-by-digit, so a tighter bound would refuse the keystrokes leading up to a legal port.
 */
export const MAX_PORT = 99999;
