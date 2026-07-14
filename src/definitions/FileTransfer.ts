// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/** No progress events for this long → treat an "active" REMOTE_SYNC slot as orphaned on reconnect. */
export const REMOTE_SYNC_PROGRESS_STALE_MS = 60_000;

/**
 * Upper bound for the remote sync HTTP call. Per-file server downloads already
 * cap at 5 minutes; this bounds the whole folder sync so a dead backend cannot
 * leave axios (and the overlay) hanging indefinitely.
 */
export const REMOTE_SYNC_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;
