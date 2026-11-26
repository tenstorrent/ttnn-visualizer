// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// tt-metal's `OpPerformanceModelGeneral` defaults every ideal time to 1 ns, so an op its model leaves out reports 1.
const UNMODELLED_IDEAL_NS = 1;

// Mirrored as `is_unmodelled` in `backend/ttnn_visualizer/agent/perf_detail.py`.
const isUnmodelledIdealTime = (idealNs: number | null): boolean => idealNs === UNMODELLED_IDEAL_NS;

export default isUnmodelledIdealTime;
