// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// Literals rather than read from the baked JSON, so the specs using them still check it. #2237
export const QUASAR_32_GRID = { x_size: 11, y_size: 8 };
export const QSR3A2_GRID = { x_size: 12, y_size: 19 };
// Every grid a `quasar` report can be drawn on from a baked descriptor, its default first.
export const BAKED_QUASAR_GRIDS = [QUASAR_32_GRID, QSR3A2_GRID];
