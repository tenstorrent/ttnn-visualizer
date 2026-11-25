// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

// d3-format arrives with plotly.js and ships no types; tests need only `format`.
declare module 'd3-format' {
    export function format(specifier: string): (value: number) => string;
}
