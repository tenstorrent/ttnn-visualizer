// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum SECTION_IDS {
    PLOT = 'plot',
    TABLE = 'table',
}

export enum TAB_IDS {
    L1 = 'L1',
    DRAM = 'DRAM',
}

// Examine current data model https://github.com/tenstorrent/ttnn-visualizer/issues/1286
export enum ColumnKeys {
    operation_id = 'operation_id',
    tensor_id = 'tensor_id',
    address = 'address',
    size = 'size',
    buffer_type = 'buffer_type',
    buffer_layout = 'buffer_layout',
    dtype = 'dtype',
    shape = 'shape',
    device_id = 'device_id',
}

export interface ColumnDefinition {
    name: string;
    key: ColumnKeys;
    width: number;
    sortable?: boolean;
    filterable?: boolean;
}

export enum ColumnHeaders {
    address = 'Address',
    buffer_layout = 'Buffer Layout',
    buffer_type = 'Buffer Type',
    device_id = 'Device Id',
    dtype = 'Data Type',
    operation_id = 'Operation',
    shape = 'Shape',
    size = 'Size',
    tensor_id = 'Tensor',
}

const DEFAULT_COLUMN_WIDTH = 140;

export const Columns: ColumnDefinition[] = [
    {
        name: ColumnHeaders.operation_id,
        key: ColumnKeys.operation_id,
        filterable: true,
        sortable: true,
        width: 200,
    },
    {
        name: ColumnHeaders.tensor_id,
        key: ColumnKeys.tensor_id,
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.address,
        key: ColumnKeys.address,
        filterable: true,
        sortable: true,
        width: 100,
    },
    {
        name: ColumnHeaders.size,
        key: ColumnKeys.size,
        filterable: true,
        sortable: true,
        width: 100,
    },
    {
        name: ColumnHeaders.shape,
        key: ColumnKeys.shape,
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.dtype,
        key: ColumnKeys.dtype,
        filterable: true,
        sortable: true,
        width: 150,
    },
    {
        name: ColumnHeaders.buffer_layout,
        key: ColumnKeys.buffer_layout,
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.buffer_type,
        key: ColumnKeys.buffer_type,
        width: 105,
    },
    {
        name: ColumnHeaders.device_id,
        key: ColumnKeys.device_id,
        width: 100,
    },
];

export type BufferTableFilters = Record<ColumnKeys, string>;
