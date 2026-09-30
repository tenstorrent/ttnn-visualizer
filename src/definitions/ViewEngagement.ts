// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// How long a counted view must stay open before a deliberate interaction records
// `view_engaged`. `docs/src/event-logging.md` states the same figure in prose, so a change
// here is a change to the documented event definition.
export const VIEW_ENGAGEMENT_THRESHOLD_MS = 10_000;
