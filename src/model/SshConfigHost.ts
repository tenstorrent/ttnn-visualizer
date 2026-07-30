// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** Concrete Host alias from GET /api/remote/ssh-config-hosts. */
export interface SshConfigHost {
    host: string;
    hostName?: string;
    user?: string;
    port?: number;
}

/** Response shape for GET /api/remote/ssh-config-hosts. */
export interface SshConfigHostsResponse {
    configExists: boolean;
    hosts: SshConfigHost[];
}
