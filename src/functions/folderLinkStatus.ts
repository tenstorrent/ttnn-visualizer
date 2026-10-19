// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { FolderLinkState } from '../definitions/FolderLinkStatus';
import { ReportLinkRunsById } from '../definitions/ReportLinks';
import { isSameRun } from './reportLinks';

const hasLinkToRun = (
    runsById: ReportLinkRunsById | null | undefined,
    reportId: string,
    runFingerprint: string | null | undefined,
): boolean => runsById?.get(reportId)?.some((run) => isSameRun(run, runFingerprint)) ?? false;

/**
 * A picker row's state from the links recorded for its folder. A link recorded against
 * another run than the one the folder holds now says nothing about this run (#2069).
 */
export const getFolderLinkState = (
    reportId: string | null,
    runFingerprint: string | null | undefined,
    linkedRuns?: ReportLinkRunsById | null,
    unlinkedRuns?: ReportLinkRunsById | null,
): FolderLinkState => {
    if (reportId && hasLinkToRun(linkedRuns, reportId, runFingerprint)) {
        return FolderLinkState.LINKED;
    }

    if (reportId && hasLinkToRun(unlinkedRuns, reportId, runFingerprint)) {
        return FolderLinkState.UNLINKED;
    }

    return FolderLinkState.UNKNOWN;
};

/** True when badge maps are present and at least one linked/unlinked counterpart exists. */
export const shouldShowFolderLinkStatus = (
    linkedRuns?: ReportLinkRunsById | null,
    unlinkedRuns?: ReportLinkRunsById | null,
): boolean => Boolean(linkedRuns?.size || unlinkedRuns?.size);
