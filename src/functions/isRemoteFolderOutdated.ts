// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';

const isRemoteFolderOutdated = (folder: RemoteFolder) => {
    const { lastSynced, lastModified } = folder;

    if (!lastSynced) {
        return true;
    }

    return lastModified > lastSynced;
};

export default isRemoteFolderOutdated;
