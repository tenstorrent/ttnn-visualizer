// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { MAX_PORT } from '../definitions/SshConnectionFields';

/**
 * The port a keystroke leaves a port field holding, or `null` when it leaves none.
 *
 * `null` means the keystroke is ignored rather than emptying the field, which is what keeps a
 * digit-by-digit field from accepting a value outside {@link MAX_PORT} along the way. Cleared
 * fields differ between the dialogs — a remote connection has no port until one is typed, an
 * MLIR server holds zero — so the caller names its own empty value rather than the helper
 * picking one and each dialog re-deriving the bound around it.
 */
const getPortFromInput = <TEmpty extends number | undefined>(
    value: string,
    emptyPort: TEmpty,
): number | TEmpty | null => {
    if (value === '') {
        return emptyPort;
    }

    const port = Number.parseInt(value, 10);

    return port > 0 && port <= MAX_PORT ? port : null;
};

export default getPortFromInput;
