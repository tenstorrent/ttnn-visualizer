// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// blue, green, purple, teal, and magenta
const PRIMARY_COLOURS = ['#0066CC', '#22AA22', '#7744BB', '#008888', '#CC4499'];

// orange, yellow, navy, brown, and lime
const SECONDARY_COLOURS = ['#FF6600', '#CCCC00', '#59ACFF', '#ff5cd9', '#66FF00'];

export const getPrimaryDataColours = (index: number) => PRIMARY_COLOURS[index];
export const getSecondaryDataColours = (index: number) => SECONDARY_COLOURS[index];
