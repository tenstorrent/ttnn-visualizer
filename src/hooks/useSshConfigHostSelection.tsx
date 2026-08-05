// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useCallback, useState } from 'react';
import { SSH_CONFIG_HOST_CUSTOM } from '../definitions/SshConfigHostPicker';

/**
 * Tracks which `~/.ssh/config` alias a connection dialog is showing, so the remote
 * connection and MLIR server dialogs share one state machine rather than two copies
 * that drift. Applying the prefill stays with the caller: the dialogs store the SSH
 * port under different keys.
 *
 * `initialHost` is the host of the connection being edited, if any — an existing
 * connection whose host matches an alias opens with that alias selected.
 */
const useSshConfigHostSelection = (initialHost?: string) => {
    const [selectedHost, setSelectedHost] = useState(() => initialHost || SSH_CONFIG_HOST_CUSTOM);

    const selectHost = useCallback((host: string) => setSelectedHost(host), []);

    /** The host was typed by hand, or the picker's own Custom option was chosen. */
    const selectCustom = useCallback(() => setSelectedHost(SSH_CONFIG_HOST_CUSTOM), []);

    /** Discard a prefill the user backed out of, so it can't leak into the next open. */
    const resetSelection = useCallback(() => setSelectedHost(initialHost || SSH_CONFIG_HOST_CUSTOM), [initialHost]);

    return { selectedHost, selectHost, selectCustom, resetSelection };
};

export default useSshConfigHostSelection;
