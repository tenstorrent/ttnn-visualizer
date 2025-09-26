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
    sortable?: boolean;
    filterable?: boolean;
}

export enum ColumnHeaders {
    operation_id = 'Operation',
    tensor_id = 'Tensor',
    address = 'Address',
    hexAddress = 'Address (hex)',
    size = 'Size',
    buffer_type = 'Buffer Type',
    device_id = 'Device Id',
}

export type ColumnKeys = keyof typeof ColumnHeaders;

export const Columns: ColumnDefinition[] = [
    {
        name: ColumnHeaders.operation_id,
        key: 'operation_id',
        sortable: true,
        filterable: true,
    },
    {
        name: ColumnHeaders.tensor_id,
        key: 'tensor_id',
        sortable: true,
        filterable: true,
    },
    {
        name: ColumnHeaders.address,
        key: 'address',
        sortable: true,
        filterable: true,
    },
    {
        name: ColumnHeaders.hexAddress,
        key: 'hexAddress',
        sortable: true,
        filterable: true,
    },
    {
        name: ColumnHeaders.size,
        key: 'size',
        sortable: true,
    },
    {
        name: ColumnHeaders.buffer_type,
        key: 'buffer_type',
    },
    {
        name: ColumnHeaders.device_id,
        key: 'device_id',
    },
];

export type BufferTableFilters = Record<ColumnKeys, string>;
