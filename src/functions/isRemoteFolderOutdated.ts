// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';

const isRemoteFolderOutdated = (folder: RemoteFolder) => {
    if (!folder.lastSynced) {
        return true;
    }

    const { lastSynced } = folder;
    const { lastModified } = folder;

    return lastModified > lastSynced;
};

export default isRemoteFolderOutdated;
