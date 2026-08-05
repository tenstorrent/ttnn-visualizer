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

/**
 * True when an entry carries the one field the picker dereferences. Entries are
 * checked individually because a single malformed one would otherwise throw while
 * rendering the option list and take the whole dialog down with it.
 */
export const isSshConfigHost = (value: unknown): value is SshConfigHost =>
    typeof value === 'object' && value !== null && typeof (value as SshConfigHost).host === 'string';
