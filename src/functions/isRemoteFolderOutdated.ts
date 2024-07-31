// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';

const isRemoteFolderOutdated = (folder: RemoteFolder) => {
    if (!folder.lastSynced) {
        return true;
    }

    const lastSynced = new Date(folder.lastSynced);
    const lastModified = new Date(folder.lastModified);

    return lastModified > lastSynced;
};

export default isRemoteFolderOutdated;
