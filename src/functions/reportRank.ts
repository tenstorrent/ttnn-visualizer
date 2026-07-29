// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

const RANK_DIRECTORY_PATTERN = /^rank(\d+)$/i;
// Synced copies carry the rank as a name suffix, since the local report folders
// are siblings and cannot nest a rank directory.
const RANK_SUFFIX_PATTERN = /_rank(\d+)$/i;

const getSegments = (remotePath: string): string[] => remotePath.split('/').filter(Boolean);

/**
 * Single source of truth for reading ranks on the client, mirroring the backend's
 * `rank_directory_from_remote_path`. Takes the last matching directory so a path
 * with more than one rank-looking segment resolves the same way the backend's
 * reversed scan does.
 */
const getRankDirectory = (segments: string[]): string | null =>
    [...segments].reverse().find((segment) => RANK_DIRECTORY_PATTERN.test(segment)) ?? null;

/**
 * Rank of a multihost report, read from either its remote `rank<N>` directory or
 * the `_rank<N>` suffix its synced copy carries. Null for single-host reports.
 */
export const getReportRank = (remotePathOrName: string): number | null => {
    const segments = getSegments(remotePathOrName);
    const rankDirectory = getRankDirectory(segments);

    if (rankDirectory) {
        return Number(rankDirectory.replace(RANK_DIRECTORY_PATTERN, '$1'));
    }

    const suffixed = (segments.at(-1) ?? '').match(RANK_SUFFIX_PATTERN);

    return suffixed ? Number(suffixed[1]) : null;
};

/** Report name without the `_rank<N>` qualifier sync appends, for display. */
export const getReportBaseName = (remotePathOrName: string): string =>
    (getSegments(remotePathOrName).at(-1) ?? '').replace(RANK_SUFFIX_PATTERN, '');

/**
 * The local folder name sync writes for a remote report. Mirrors the backend's
 * `folder_segment_from_remote_path`, including the `_rank<N>` qualifier that keeps
 * identically named reports from different ranks apart.
 */
export const getSyncedFolderName = (remotePath: string): string => {
    const segments = getSegments(remotePath);
    const reportName = segments.at(-1) ?? '';
    const rankDirectory = getRankDirectory(segments);

    return rankDirectory && rankDirectory !== reportName ? `${reportName}_${rankDirectory}` : reportName;
};
