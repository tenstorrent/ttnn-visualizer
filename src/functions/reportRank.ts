// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Rank labelling for multihost performance reports.
 *
 * The server decides which rank a report belongs to and what its synced folder
 * is called (`folder_segment_from_remote_path`), and reports both on the wire —
 * it is the only side that writes the folder. Nothing here parses a path or
 * recomputes a folder name; a client-side twin of that rule would be free to
 * drift from the directory that actually got written.
 */

// Synced report folders are siblings on local disk and so cannot nest a rank
// directory; the rank rides along as a name suffix instead.
const RANK_SUFFIX_PATTERN = /_rank(\d+)$/i;

/** `Rank 0: 2026_07_28_18_04_24`, or just the report name when there is no rank. */
export const getRankedReportLabel = (reportName: string, rank?: number | null): string =>
    rank === null || rank === undefined ? reportName : `Rank ${rank}: ${reportName}`;

/**
 * Label a report known only by its synced folder name — the shape the app carries
 * once a report is mounted, where no remote listing is at hand to ask.
 *
 * Display only. The rank read back here is not an identity: a single-host report
 * genuinely named `<name>_rank3` is indistinguishable from rank 3 of `<name>`,
 * which costs a cosmetic label but must never choose a directory.
 */
export const formatSyncedReportName = (syncedName: string): string => {
    const match = syncedName.match(RANK_SUFFIX_PATTERN);

    return match ? getRankedReportLabel(syncedName.slice(0, match.index), Number(match[1])) : syncedName;
};
