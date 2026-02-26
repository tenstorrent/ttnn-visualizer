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

export type ColumnKeys = keyof typeof ColumnHeaders;

const DEFAULT_COLUMN_WIDTH = 140;

export const Columns: ColumnDefinition[] = [
    {
        name: ColumnHeaders.operation_id,
        key: 'operation_id',
        filterable: true,
        sortable: true,
        width: 200,
    },
    {
        name: ColumnHeaders.tensor_id,
        key: 'tensor_id',
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.address,
        key: 'address',
        filterable: true,
        sortable: true,
        width: 100,
    },
    {
        name: ColumnHeaders.size,
        key: 'size',
        filterable: true,
        sortable: true,
        width: 100,
    },
    {
        name: ColumnHeaders.shape,
        key: 'shape',
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.dtype,
        key: 'dtype',
        filterable: true,
        sortable: true,
        width: 150,
    },
    {
        name: ColumnHeaders.buffer_layout,
        key: 'buffer_layout',
        filterable: true,
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.buffer_type,
        key: 'buffer_type',
        width: 105,
    },
    {
        name: ColumnHeaders.device_id,
        key: 'device_id',
        width: 100,
    },
];

export type BufferTableFilters = Record<ColumnKeys, string>;
