// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError } from 'axios';
import { useQuery } from '@tanstack/react-query';
import Endpoints from '../definitions/Endpoints';
import { SshConfigHostsResponse, isSshConfigHost } from '../model/SshConfigHost';
import getServerConfig from '../functions/getServerConfig';
import axiosInstance from '../libs/axiosInstance';

const SSH_CONFIG_HOSTS_QUERY_KEY = ['ssh-config-hosts'] as const;

const fetchSshConfigHosts = async (): Promise<SshConfigHostsResponse> => {
    const response = await axiosInstance.get<SshConfigHostsResponse>(Endpoints.REMOTE_SSH_CONFIG_HOSTS);
    const { data } = response;

    if (!data || typeof data !== 'object' || !Array.isArray(data.hosts)) {
        return { configExists: false, hosts: [] };
    }

    return {
        configExists: Boolean(data.configExists),
        hosts: data.hosts.filter(isSshConfigHost),
    };
};

/**
 * Loads concrete Host aliases from the local ~/.ssh/config (local installs only).
 * Refetches when the dialog opens so edits to ~/.ssh/config appear without a full reload.
 */
const useSshConfigHosts = (enabled = true) => {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;

    return useQuery<SshConfigHostsResponse, AxiosError>({
        queryKey: SSH_CONFIG_HOSTS_QUERY_KEY,
        queryFn: fetchSshConfigHosts,
        enabled: enabled && !isServerMode,
        staleTime: 0,
        refetchOnMount: 'always',
        // The picker hides itself on error, so retries would re-walk ~/.ssh/config
        // and its includes three more times for nothing.
        retry: false,
    });
};

export default useSshConfigHosts;
