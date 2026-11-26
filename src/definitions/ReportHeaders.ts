// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Names the memory report a response was answered for, percent-encoded. Mirrors
 * ACTIVE_MEMORY_REPORT_HEADER in backend/ttnn_visualizer/decorators.py; lower-case
 * because axios normalises response header names.
 */
export const ACTIVE_MEMORY_REPORT_HEADER = 'x-active-memory-report';
