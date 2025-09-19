// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export type StackedTableKeys = Partial<keyof StackedPerfRow>;

export type StackedTableFilter = Record<StackedTableKeys, string> | null;

export interface StackedTableHeader {
    label: string;
    key: StackedTableKeys;
    colour?: string;
    unit?: string;
    decimals?: number;
    sortable?: boolean;
    filterable?: boolean;
}

export interface StackedPerfRow {
    percent: string;
    op_code: string;
    device_time_sum_us: string;
    ops_count: string;
    flops_min: string;
    flops_max: string;
    flops_mean: string;
    flops_std: string;
    is_signpost: boolean;
}

export interface TypedStackedPerfRow
    extends Omit<
        StackedPerfRow,
        'percent' | 'device_time_sum_us' | 'ops_count' | 'flops_min' | 'flops_max' | 'flops_mean' | 'flops_std'
    > {
    percent: number | null;
    device_time_sum_us: number | null;
    ops_count: number | null;
    flops_min: number | null;
    flops_max: number | null;
    flops_mean: number | null;
    flops_std: number | null;
    is_signpost: boolean;
}

export enum ColumnHeaders {
    Percent = 'percent',
    OpCodeJoined = 'op_code',
    DeviceTimeSumUs = 'device_time_sum_us',
    OpsCount = 'ops_count',
    FlopsMin = 'flops_min',
    FlopsMax = 'flops_max',
    FlopsMean = 'flops_mean',
    FlopsStd = 'flops_std',
}

export const TableHeaders: StackedTableHeader[] = [
    { label: 'Percent', key: ColumnHeaders.Percent, unit: '%', decimals: 1, sortable: true },
    { label: 'Op Code', key: ColumnHeaders.OpCodeJoined, sortable: true, filterable: true },
    { label: 'Device Time', key: ColumnHeaders.DeviceTimeSumUs, unit: 'µs', decimals: 1, sortable: true },
    { label: 'Ops Count', key: ColumnHeaders.OpsCount, sortable: true },
    { label: 'Min FLOPS', key: ColumnHeaders.FlopsMin, unit: '%', decimals: 1, sortable: true },
    { label: 'Max FLOPS', key: ColumnHeaders.FlopsMax, unit: '%', decimals: 1, sortable: true },
    { label: 'Mean FLOPS', key: ColumnHeaders.FlopsMean, unit: '%', decimals: 1, sortable: true },
    { label: 'Std FLOPS', key: ColumnHeaders.FlopsStd, unit: '%', decimals: 1, sortable: true },
];

export const FilterableStackedColumnKeys = TableHeaders.filter((column) => column.filterable).map(
    (column) => column.key,
);
