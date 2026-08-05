// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { SshConfigHost } from '../model/SshConfigHost';

/** Form values a prefill falls back on when the config stanza is sparse. */
interface SshConfigHostPrefillContext {
    name?: string;
    username?: string;
    port?: number;
    defaultUsername: string;
    defaultPort: number;
}

/** Connection fields one `~/.ssh/config` stanza contributes to a dialog. */
export interface SshConfigHostPrefill {
    host: string;
    name: string;
    username: string;
    port: number;
    identityFile: undefined;
}

/**
 * Maps a `~/.ssh/config` stanza onto connection-form fields for the remote
 * connection and MLIR server dialogs, which differ only in the key they store the
 * SSH port under.
 */
const getSshConfigHostPrefill = (
    host: SshConfigHost,
    { name, username, port, defaultUsername, defaultPort }: SshConfigHostPrefillContext,
): SshConfigHostPrefill => ({
    host: host.host,
    // A connection name the user typed is theirs to keep; only seed an empty one.
    name: name?.trim() || host.host,
    // Prefer config User; otherwise keep the existing/default username so the field
    // stays populated when User is only implied by OpenSSH (local login).
    username: host.user?.trim() || username?.trim() || defaultUsername,
    port: host.port ?? port ?? defaultPort,
    // Drop any identity file so OpenSSH keeps applying ProxyJump and IdentityFile
    // from the config for this alias.
    identityFile: undefined,
});

export default getSshConfigHostPrefill;
