// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Bounds the within-graph cache when the user cycles through many
// distinct expansion sets. Cross-graph eviction is handled by the
// parent's `key={graph.id}` remount.
export const CACHE_LIMIT_PER_GRAPH = 32;
