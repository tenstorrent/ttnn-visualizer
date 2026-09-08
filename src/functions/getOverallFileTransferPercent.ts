// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FileProgress, FileStatus } from '../model/APIData';

/** Job-level percent for multi-file remote sync; per-file percent for uploads. */
export function getOverallFileTransferPercent(progress: FileProgress): number {
    const { numberOfFiles, finishedFiles, percentOfCurrent, status } = progress;

    if (numberOfFiles > 0 && (status === FileStatus.DOWNLOADING || status === FileStatus.STARTED)) {
        // Integer math + round to avoid float artifacts like 30.000000000000004
        // leaking into ProgressBar / formatPercentage from divisions such as
        // 1/3 or 2/7.
        return Math.min(100, Math.max(0, Math.round((finishedFiles * 100) / numberOfFiles)));
    }

    return Math.min(100, Math.max(0, percentOfCurrent));
}
