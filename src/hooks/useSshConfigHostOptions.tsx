// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { SshConfigHost } from '../model/SshConfigHost';
import getServerConfig from '../functions/getServerConfig';
import useSshConfigHosts from './useSshConfigHosts';

// Shared and frozen so an absent payload doesn't hand a consumer's memos a new array
// identity on every render of the surrounding dialog.
const NO_HOSTS: readonly SshConfigHost[] = Object.freeze([]);

/**
 * The `~/.ssh/config` aliases the picker can offer, and whether it can offer any at all.
 * A dialog that holds its form back until a host is chosen has to reach the same answer
 * as the picker itself, or it would wait on a choice from a control that never renders.
 */
const useSshConfigHostOptions = (enabled = true) => {
    // Reading ~/.ssh/config is local-only; hide under hosted SERVER_MODE (AGENTS.md).
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const { data, isError, isPending } = useSshConfigHosts(enabled && !isServerMode);
    const hosts = data?.hosts ?? NO_HOSTS;

    return {
        hosts,
        isAvailable: !isServerMode && !isError && !isPending && data?.configExists === true && hosts.length > 0,
        // A disabled query stays pending forever, so SERVER_MODE would otherwise read as still loading.
        isResolving: !isServerMode && isPending,
    };
};

export default useSshConfigHostOptions;
