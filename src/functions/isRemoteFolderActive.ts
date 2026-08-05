// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { RemoteFolder } from '../definitions/RemoteConnection';
import { ReportFolder } from '../definitions/Reports';

/**
 * Whether a listed folder is the report currently loaded.
 *
 * A freshly selected report is identified by its remote path, while a report
 * restored after a reload is identified by the folder it synced into — the same
 * report reaches this predicate under either spelling, so both are compared.
 */
export default function isRemoteFolderActive(folder: RemoteFolder, activeReport: ReportFolder): boolean {
    if (folder.remotePath === activeReport.path) {
        return true;
    }

    return !!folder.syncedName && folder.syncedName === (activeReport.syncedName ?? activeReport.path);
}
