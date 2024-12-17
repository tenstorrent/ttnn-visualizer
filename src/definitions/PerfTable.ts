// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { IconName } from '@blueprintjs/core';

export interface Cell {
    raw_value: string | number | null | undefined | boolean;
    icon?: IconName;
    iconColor?: string;
    tooltip?: string;
    unit?: string;
    decimals?: number;
    color?: string;
}

export interface RowData {
    [key: string]: string | number | null | undefined;
}

export interface ProcessedRow {
    [key: string]: Cell;
}

export type MathFidelity = 'HiFi4' | 'HiFi2' | 'LoFi';
