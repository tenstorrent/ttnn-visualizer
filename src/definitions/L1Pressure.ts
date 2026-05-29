// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Thresholds calibrated against real reports (resnet50, llama_attn_32l). Persistent-tensor L1 alone
// (CBs excluded) caps well below total L1 capacity, so the absolute-capacity scale would never fire.
export const L1_FULLNESS_WARNING_PERCENT = 25;
export const L1_FULLNESS_CRITICAL_PERCENT = 50;
export const L1_LARGEST_FREE_WARNING_PERCENT = 60;
export const L1_LARGEST_FREE_CRITICAL_PERCENT = 30;
