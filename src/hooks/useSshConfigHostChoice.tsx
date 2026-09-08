// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useState } from 'react';
import { SSH_CONFIG_HOST_CUSTOM, SSH_CONFIG_HOST_UNSELECTED } from '../definitions/SshConfigHostPicker';
import useSshConfigHostOptions from './useSshConfigHostOptions';

interface SshConfigHostChoiceOptions {
    /** Dialog visibility, so a closed dialog leaves `~/.ssh/config` unread. */
    open: boolean;
    /** False when the dialog is editing a saved target rather than adding a new one. */
    isAdding: boolean;
    /** Host of the target being edited, so one pointing at an alias opens on that alias. */
    initialHost?: string;
}

/**
 * Which `~/.ssh/config` alias a connection dialog is showing, and whether the dialog should
 * still be waiting on that choice.
 *
 * The remote connection and MLIR server dialogs share one state machine rather than two copies
 * that drift: both prefill the same fields from the same stanza, and both would otherwise have
 * to restate when the picker can render at all. Selection is tracked separately from the host
 * itself so two stanzas resolving to the same HostName and port stay distinguishable.
 */
const useSshConfigHostChoice = ({ open, isAdding, initialHost }: SshConfigHostChoiceOptions) => {
    // Without an existing host there is nothing to report yet, so a new target starts on
    // neither an alias nor the add-new option until the user picks one.
    const [selectedHost, setSelectedHost] = useState(() => initialHost || SSH_CONFIG_HOST_UNSELECTED);

    const selectHost = useCallback((host: string) => setSelectedHost(host), []);

    /** The host was typed by hand, or the picker's own add-new option was chosen. */
    const selectCustom = useCallback(() => setSelectedHost(SSH_CONFIG_HOST_CUSTOM), []);

    /** Discard a prefill the user backed out of, so it can't leak into the next open. */
    const resetSelection = useCallback(() => setSelectedHost(initialHost || SSH_CONFIG_HOST_UNSELECTED), [initialHost]);

    // The picker exists to seed a target that has no values yet. An edit has them, and the
    // prefill overwrites host, name, username, port and identity file together, so offering
    // it there is offering to undo the edit. Not asking also keeps ~/.ssh/config unread.
    const { isAvailable, isResolving } = useSshConfigHostOptions(open && isAdding);

    // A new target is a choice between the ~/.ssh/config aliases and filling the form in by
    // hand, so the form itself only competes with that choice. There is nothing to choose from
    // when the picker can't render — including while the config is still loading, which would
    // otherwise show the form only to take it away again.
    const isAwaitingHostChoice =
        isAdding && selectedHost === SSH_CONFIG_HOST_UNSELECTED && (isResolving || isAvailable);

    return { selectedHost, selectHost, selectCustom, resetSelection, isAwaitingHostChoice };
};

export default useSshConfigHostChoice;
