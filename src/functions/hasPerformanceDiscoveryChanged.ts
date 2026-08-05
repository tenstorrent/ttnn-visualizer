// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteConnection } from '../definitions/RemoteConnection';

/**
 * True when an edit changed where performance reports are discovered, which makes
 * every cached remote path for that connection stale.
 */
const hasPerformanceDiscoveryChanged = (
    oldConnection?: RemoteConnection,
    newConnection?: RemoteConnection,
): boolean => {
    if (!oldConnection || !newConnection) {
        return false;
    }

    return (
        oldConnection.performancePath !== newConnection.performancePath ||
        Boolean(oldConnection.multihostPerformance) !== Boolean(newConnection.multihostPerformance)
    );
};

export default hasPerformanceDiscoveryChanged;
