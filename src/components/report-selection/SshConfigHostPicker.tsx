// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FormGroup, HTMLSelect } from '@blueprintjs/core';
import { SSH_CONFIG_HOST_CUSTOM, SshConfigHost } from '../../definitions/RemoteConnection';
import useSshConfigHosts, { getSshConfigHostLabel } from '../../hooks/useSshConfigHosts';

interface SshConfigHostPickerProps {
    /** Currently selected alias, or {@link SSH_CONFIG_HOST_CUSTOM}. */
    value: string;
    /** When false, skip fetching (dialog closed). */
    enabled?: boolean;
    onSelectCustom: () => void;
    onSelectHost: (host: SshConfigHost) => void;
}

const SshConfigHostPicker = ({ value, enabled = true, onSelectCustom, onSelectHost }: SshConfigHostPickerProps) => {
    const { data: hosts = [], isError, isFetching } = useSshConfigHosts(enabled);

    if (isError || (!isFetching && hosts.length === 0)) {
        return null;
    }

    const handleChange = (selected: string) => {
        if (selected === SSH_CONFIG_HOST_CUSTOM) {
            onSelectCustom();
            return;
        }

        const host = hosts.find((entry) => entry.host === selected);
        if (host) {
            onSelectHost(host);
        }
    };

    return (
        <FormGroup
            label='SSH config host'
            subLabel='Prefill from ~/.ssh/config. Selecting a host clears the identity file so OpenSSH can apply config (ProxyJump, IdentityFile). The app still connects as user@host, which overrides config User.'
            labelFor='ssh-config-host-picker'
        >
            <HTMLSelect
                id='ssh-config-host-picker'
                fill
                disabled={isFetching}
                value={hosts.some((host) => host.host === value) ? value : SSH_CONFIG_HOST_CUSTOM}
                onChange={(event) => handleChange(event.currentTarget.value)}
            >
                <option value={SSH_CONFIG_HOST_CUSTOM}>Custom</option>
                {hosts.map((host) => (
                    <option
                        key={host.host}
                        value={host.host}
                    >
                        {getSshConfigHostLabel(host)}
                    </option>
                ))}
            </HTMLSelect>
        </FormGroup>
    );
};

export default SshConfigHostPicker;
