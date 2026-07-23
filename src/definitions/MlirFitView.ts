// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type { FitViewOptions } from '@xyflow/react';

// bulk = initial + expand/collapse-all (instant); localJump = recenter /
// navigate / match-cycling (short animation to track the move).
export const MLIR_FIT_VIEW_OPTIONS = {
    bulk: { padding: 0.2, duration: 0 },
    localJump: { padding: 0.3, duration: 200 },
} as const satisfies Record<'bulk' | 'localJump', FitViewOptions>;
