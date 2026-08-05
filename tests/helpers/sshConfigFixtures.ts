// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { SshConfigHost, SshConfigHostsResponse } from '../../src/model/SshConfigHost';

/** The slice of the useSshConfigHosts query result that SshConfigHostPicker reads. */
export interface SshConfigHostsQueryResult {
    data: SshConfigHostsResponse | undefined;
    isError: boolean;
    isPending: boolean;
}

/** Settled query holding `hosts`, i.e. ~/.ssh/config exists and parsed. */
export const sshConfigHostsResult = (hosts: SshConfigHost[]): SshConfigHostsQueryResult => ({
    data: { configExists: true, hosts },
    isError: false,
    isPending: false,
});

/** Settled query for a machine with no ~/.ssh/config — the picker hides itself. */
export const noSshConfigResult = (): SshConfigHostsQueryResult => ({
    data: { configExists: false, hosts: [] },
    isError: false,
    isPending: false,
});

export const pendingSshConfigResult = (): SshConfigHostsQueryResult => ({
    data: undefined,
    isError: false,
    isPending: true,
});

export const failedSshConfigResult = (hosts: SshConfigHost[] = []): SshConfigHostsQueryResult => ({
    data: { configExists: true, hosts },
    isError: true,
    isPending: false,
});

export const MOCK_SSH_CONFIG_HOST: SshConfigHost = {
    host: 'work-gpu',
    hostName: 'gpu.example.com',
    user: 'alice',
    port: 2222,
};
