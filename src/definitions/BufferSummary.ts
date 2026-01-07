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
    operation_id = 'Operation',
    tensor_id = 'Tensor',
    address = 'Address',
    hexAddress = 'Address (hex)',
    size = 'Size (bytes)',
    buffer_type = 'Buffer Type',
    device_id = 'Device Id',
}

export type ColumnKeys = keyof typeof ColumnHeaders;

const DEFAULT_COLUMN_WIDTH = 120;

export const Columns: ColumnDefinition[] = [
    {
        name: ColumnHeaders.operation_id,
        key: 'operation_id',
        sortable: true,
        filterable: true,
        width: 200,
    },
    {
        name: ColumnHeaders.tensor_id,
        key: 'tensor_id',
        sortable: true,
        filterable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.address,
        key: 'address',
        sortable: true,
        filterable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.hexAddress,
        key: 'hexAddress',
        sortable: true,
        filterable: true,
        width: 140,
    },
    {
        name: ColumnHeaders.size,
        key: 'size',
        sortable: true,
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.buffer_type,
        key: 'buffer_type',
        width: DEFAULT_COLUMN_WIDTH,
    },
    {
        name: ColumnHeaders.device_id,
        key: 'device_id',
        width: 100,
    },
];

export type BufferTableFilters = Record<ColumnKeys, string>;
