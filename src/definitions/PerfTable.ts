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
    'DEVICE ID'?: number;
    'HOST START TS'?: number;
    'DEVICE FW DURATION [ns]'?: number;
    'DEVICE KERNEL DURATION [ns]'?: number;
    'OP CODE'?: string;
    'OP TO OP LATENCY [ns]'?: number;
    'CORE COUNT'?: number;
    INPUT_0_W?: number;
    INPUT_0_X?: number;
    INPUT_0_Y?: number;
    INPUT_0_Z?: number;
    INPUT_0_MEMORY?: string;
    INPUT_0_DATATYPE?: string;
    INPUT_1_W?: number;
    INPUT_1_X?: number;
    INPUT_1_Y?: number;
    INPUT_1_Z?: number;
    INPUT_1_MEMORY?: string;
    INPUT_1_DATATYPE?: string;
    OUTPUT_0_W?: number;
    OUTPUT_0_X?: number;
    OUTPUT_0_Y?: number;
    OUTPUT_0_Z?: number;
    OUTPUT_0_MEMORY?: string;
    OUTPUT_0_DATATYPE?: string;
    'MATH FIDELITY'?: string;
    ATTRIBUTES?: string;
    'OP TYPE'?: string;
    'PM IDEAL [ns]'?: number;

    ORIGINAL_ID?: number;
}

export interface ProcessedRow {
    [key: string]: Cell;
}

export type MathFidelity = 'HiFi4' | 'HiFi2' | 'LoFi';
