// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Mirrored as `DEALLOCATE_OPERATION_NAMES` in `backend/ttnn_visualizer/agent/late_deallocations.py`.
export const DEALLOCATE_OP_NAME_LIST = ['ttnn.deallocate', 'ttnn::deallocate'];

const DEALLOCATE_OP_NAMES = new Set(DEALLOCATE_OP_NAME_LIST);

/** Mirrored as `is_deallocate` in `backend/ttnn_visualizer/agent/late_deallocations.py`. */
export const isDeallocate = (name: string | null | undefined): boolean =>
    DEALLOCATE_OP_NAMES.has((name ?? '').toLowerCase());
