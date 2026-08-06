// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FormGroup, HTMLSelect } from '@blueprintjs/core';
import classNames from 'classnames';
import { useMemo } from 'react';
import {
    SSH_CONFIG_HOST_CUSTOM,
    SSH_CONFIG_HOST_CUSTOM_LABEL,
    SSH_CONFIG_HOST_INPUT_ID,
    SSH_CONFIG_HOST_LABEL,
    SSH_CONFIG_HOST_SUBLABEL,
    SSH_CONFIG_HOST_UNSELECTED,
    SSH_CONFIG_HOST_UNSELECTED_LABEL,
} from '../../definitions/SshConfigHostPicker';
import { SshConfigHost } from '../../model/SshConfigHost';
import { getSshConfigHostLabel } from '../../functions/formatting';
import useSshConfigHostOptions from '../../hooks/useSshConfigHostOptions';
import 'styles/components/SshConfigHostPicker.scss';

interface SshConfigHostPickerProps {
    /** Selected alias, {@link SSH_CONFIG_HOST_CUSTOM}, or {@link SSH_CONFIG_HOST_UNSELECTED}. */
    value: string;
    /** When false, skip fetching (dialog closed). */
    enabled?: boolean;
    onSelectCustom: () => void;
    onSelectHost: (host: SshConfigHost) => void;
}

const SshConfigHostPicker = ({ value, enabled = true, onSelectCustom, onSelectHost }: SshConfigHostPickerProps) => {
    const { hosts, isAvailable } = useSshConfigHostOptions(enabled);

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
    if (!isAvailable) {
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

    // A host typed by hand belongs to the Custom option; nothing chosen yet belongs to neither.
    const isUnselected = value === SSH_CONFIG_HOST_UNSELECTED;
    const selectedValue = isUnselected || aliases.has(value) ? value : SSH_CONFIG_HOST_CUSTOM;

    return (
        <FormGroup
            className='ssh-config-host-picker'
            label={SSH_CONFIG_HOST_LABEL}
            subLabel={SSH_CONFIG_HOST_SUBLABEL}
            labelFor={SSH_CONFIG_HOST_INPUT_ID}
        >
            <HTMLSelect
                id={SSH_CONFIG_HOST_INPUT_ID}
                className={classNames({ 'ssh-config-host-placeholder': isUnselected })}
                fill
                value={selectedValue}
                onChange={(event) => handleChange(event.currentTarget.value)}
            >
                {/* Blueprint types a `placeholder` prop, but it only spreads onto the <select>,
                    where HTML ignores it — a prompt has to be an option the value can point at.
                    Disabled so it can't be chosen, and dropped once a choice is made, since
                    there is no going back to having chosen nothing. */}
                {isUnselected && (
                    <option
                        value={SSH_CONFIG_HOST_UNSELECTED}
                        disabled
                    >
                        {SSH_CONFIG_HOST_UNSELECTED_LABEL}
                    </option>
                )}
                <option value={SSH_CONFIG_HOST_CUSTOM}>{SSH_CONFIG_HOST_CUSTOM_LABEL}</option>
                {options}
            </HTMLSelect>
        </FormGroup>
    );
};

export default SshConfigHostPicker;
