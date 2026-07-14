// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Reconnect orphan window for REMOTE_SYNC progress.
 * Backend emits are file-granular and a single download can run up to the 5-minute
 * SFTP/SCP per-file timeout with no further events — keep this above that bound
 * (+ margin) so a mid-file socket reconnect does not wipe a live overlay.
 */
export const REMOTE_SYNC_PROGRESS_STALE_MS = 6 * 60 * 1000;

/**
 * Upper bound for the remote sync HTTP call. Per-file server downloads already
 * cap at 5 minutes; this bounds the whole folder sync so a dead backend cannot
 * leave axios (and the overlay) hanging indefinitely.
 */
export const REMOTE_SYNC_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
