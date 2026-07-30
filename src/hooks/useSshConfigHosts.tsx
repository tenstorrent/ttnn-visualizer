// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError } from 'axios';
import { useQuery } from '@tanstack/react-query';
import Endpoints from '../definitions/Endpoints';
import { SshConfigHost } from '../definitions/RemoteConnection';
import getServerConfig from '../functions/getServerConfig';
import axiosInstance from '../libs/axiosInstance';

export const SSH_CONFIG_HOSTS_QUERY_KEY = ['ssh-config-hosts'] as const;

const fetchSshConfigHosts = async (): Promise<SshConfigHost[]> => {
    const response = await axiosInstance.get<SshConfigHost[]>(Endpoints.REMOTE_SSH_CONFIG_HOSTS);
    return Array.isArray(response.data) ? response.data : [];
};

export const getSshConfigHostLabel = (host: SshConfigHost): string =>
    host.hostName ? `${host.host} — ${host.hostName}` : host.host;

/**
 * Loads concrete Host aliases from the local ~/.ssh/config (local installs only).
 * Refetches when the dialog opens so edits to ~/.ssh/config appear without a full reload.
 */
const useSshConfigHosts = (enabled = true) => {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;

    return useQuery<SshConfigHost[], AxiosError>({
        queryKey: SSH_CONFIG_HOSTS_QUERY_KEY,
        queryFn: fetchSshConfigHosts,
        enabled: enabled && !isServerMode,
        staleTime: 0,
        refetchOnMount: 'always',
    });
};

export default useSshConfigHosts;
