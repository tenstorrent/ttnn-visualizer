// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FormGroup, HTMLSelect } from '@blueprintjs/core';
import { useMemo } from 'react';
import {
    SSH_CONFIG_HOST_CUSTOM,
    SSH_CONFIG_HOST_CUSTOM_LABEL,
    SSH_CONFIG_HOST_INPUT_ID,
    SSH_CONFIG_HOST_LABEL,
    SSH_CONFIG_HOST_SUBLABEL,
} from '../../definitions/SshConfigHostPicker';
import { SshConfigHost } from '../../model/SshConfigHost';
import { getSshConfigHostLabel } from '../../functions/formatting';
import getServerConfig from '../../functions/getServerConfig';
import useSshConfigHosts from '../../hooks/useSshConfigHosts';

// Shared and frozen so an absent payload doesn't hand the memos below a new array
// identity on every render of the surrounding dialog.
const NO_HOSTS: readonly SshConfigHost[] = Object.freeze([]);

interface SshConfigHostPickerProps {
    /** Currently selected alias, or {@link SSH_CONFIG_HOST_CUSTOM}. */
    value: string;
    /** When false, skip fetching (dialog closed). */
    enabled?: boolean;
    onSelectCustom: () => void;
    onSelectHost: (host: SshConfigHost) => void;
}

const SshConfigHostPicker = ({ value, enabled = true, onSelectCustom, onSelectHost }: SshConfigHostPickerProps) => {
    // Reading ~/.ssh/config is local-only; hide under hosted SERVER_MODE (AGENTS.md).
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const { data, isError, isPending } = useSshConfigHosts(enabled && !isServerMode);
    const hosts = data?.hosts ?? NO_HOSTS;
    const configExists = data?.configExists === true;

    // A generated SSH config can run to thousands of stanzas, and every keystroke in
    // the surrounding dialog re-renders this component.
    const aliases = useMemo(() => new Set(hosts.map((host) => host.host)), [hosts]);
    const options = useMemo(
        () =>
            hosts.map((host) => (
                <option
                    key={host.host}
                    value={host.host}
                >
                    {getSshConfigHostLabel(host)}
                </option>
            )),
        [hosts],
    );

    // Hide when ~/.ssh/config is missing, empty of concrete hosts, still loading, or errored.
    if (isServerMode || isError || isPending || !configExists || hosts.length === 0) {
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
            label={SSH_CONFIG_HOST_LABEL}
            subLabel={SSH_CONFIG_HOST_SUBLABEL}
            labelFor={SSH_CONFIG_HOST_INPUT_ID}
        >
            <HTMLSelect
                id={SSH_CONFIG_HOST_INPUT_ID}
                fill
                value={aliases.has(value) ? value : SSH_CONFIG_HOST_CUSTOM}
                onChange={(event) => handleChange(event.currentTarget.value)}
            >
                <option value={SSH_CONFIG_HOST_CUSTOM}>{SSH_CONFIG_HOST_CUSTOM_LABEL}</option>
                {options}
            </HTMLSelect>
        </FormGroup>
    );
};

export default SshConfigHostPicker;
