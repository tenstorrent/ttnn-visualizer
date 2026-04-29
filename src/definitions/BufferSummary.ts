// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import type { PlotData } from 'plotly.js';

export enum SECTION_IDS {
    PLOT = 'plot',
    TABLE = 'table',
}

export enum TAB_IDS {
    L1 = 'L1',
    DRAM = 'DRAM',
}

export enum ColumnKeys {
    OperationId = 'operation_id',
    TensorId = 'tensor_id',
    Address = 'address',
    Size = 'size',
    BufferType = 'buffer_type',
    BufferLayout = 'buffer_layout',
    Dtype = 'dtype',
    Shape = 'shape',
    DeviceId = 'device_id',
}

interface ColumnDefinition {
    name: string;
    key: ColumnKeys;
    width: number;
    sortable?: boolean;
    filterable?: boolean;
}

const DEFAULT_COLUMN_WIDTH = 140;

export const Columns: ColumnDefinition[] = [
    {
        name: 'Operation',
        key: ColumnKeys.OperationId,
        filterable: true,
        sortable: true,
        width: 200,
    },
    {
        name: 'Tensor',
        key: ColumnKeys.TensorId,
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: 'Address',
        key: ColumnKeys.Address,
        filterable: true,
        sortable: true,
        width: 100,
    },
    {
        name: 'Size',
        key: ColumnKeys.Size,
        filterable: true,
        sortable: true,
        width: 100,
    },
    {
        name: 'Shape',
        key: ColumnKeys.Shape,
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: 'Data Type',
        key: ColumnKeys.Dtype,
        filterable: true,
        sortable: true,
        width: 150,
    },
    {
        name: 'Buffer Layout',
        key: ColumnKeys.BufferLayout,
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: 'Buffer Type',
        key: ColumnKeys.BufferType,
        width: 105,
    },
    {
        name: 'Device Id',
        key: ColumnKeys.DeviceId,
        width: 100,
    },
];

export type BufferTableFilters = Record<ColumnKeys, string>;

export const OPERATION_EL_HEIGHT = 28; // Height in px of each list item (including padding/margin)
export const TOTAL_SHADE_HEIGHT = 20; // Combined height in px of 'scroll-shade' pseudo elements
export const MEMORY_ZOOM_PADDING_RATIO = 0.01;

export const CHART_DATA: Partial<PlotData>[][] = [
    [
        {
            x: [0],
            y: [1],
            type: 'bar',
            width: [0],
            marker: {
                color: 'transparent',
            },
        },
    ],
];
