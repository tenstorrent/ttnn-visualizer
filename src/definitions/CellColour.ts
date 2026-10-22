// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

export enum CellColour {
    White = 'white',
    Green = 'green',
    Red = 'red',
    Blue = 'blue',
    Magenta = 'magenta',
    Cyan = 'cyan',
    Yellow = 'yellow',
    Orange = 'orange',
    Grey = 'grey',
}

// Declared here rather than beside their consumers: `react-refresh/only-export-components`
// reads a capitalised constant initialised from `CellColour.X` as a component alias, and
// the perf `.tsx` formatters export no components, so a local copy fails lint.
export const DEFAULT_CELL_COLOUR = CellColour.White;
export const FALLBACK_CELL_COLOUR = CellColour.Grey;
export const WARNING_CELL_COLOUR = CellColour.Yellow;
