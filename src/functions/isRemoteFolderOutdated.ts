// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RemoteFolder } from '../model/RemoteConnection';

const isRemoteFolderOutdated = (folder: RemoteFolder) => {
    const { lastSynced, lastModified } = folder;

    if (!lastSynced) {
        return true;
    }

    return lastModified > lastSynced;
};

export default isRemoteFolderOutdated;
