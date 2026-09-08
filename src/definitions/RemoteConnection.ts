// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const DEFAULT_SSH_PORT = 22;

export const SYNC_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
});

export const REMOTE_MEMORY_PATH_LABEL = 'Remote Memory Report Folder Path';
export const REMOTE_PERFORMANCE_PATH_LABEL = 'Remote Performance Report Folder Path';
export const MULTIHOST_GROUP_LABEL = 'Multihost Performance Reports';
export const MULTIHOST_CHECKBOX_LABEL = 'Search per-rank subdirectories';
export const FETCH_REMOTE_FOLDERS_LABEL = 'Fetch remote folders';
export const NEVER_SYNCED_LABEL = 'Never synced';
export const REPORT_OUTDATED_LABEL = 'Report is stale';
export const REPORT_UP_TO_DATE_LABEL = 'Report recently synced';
