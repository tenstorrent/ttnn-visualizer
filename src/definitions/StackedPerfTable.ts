// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OpType } from './Performance';

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
    op_code_joined: string;
    device: string;
    device_time_sum_us: string;
    ops_count: string;
    flops_min: string;
    flops_max: string;
    flops_mean: string;
    flops_std: string;
    op_type: OpType;
}

export interface TypedStackedPerfRow
    extends Omit<
        StackedPerfRow,
        | 'percent'
        | 'device'
        | 'device_time_sum_us'
        | 'ops_count'
        | 'flops_min'
        | 'flops_max'
        | 'flops_mean'
        | 'flops_std'
    > {
    percent: number | null;
    device: number | null;
    device_time_sum_us: number | null;
    ops_count: number | null;
    flops_min: number | null;
    flops_max: number | null;
    flops_mean: number | null;
    flops_std: number | null;
}

export enum ColumnHeaders {
    Percent = 'percent',
    OpCodeJoined = 'op_code_joined',
    Device = 'device',
    DeviceTimeSumUs = 'device_time_sum_us',
    OpsCount = 'ops_count',
    FlopsMin = 'flops_min',
    FlopsMax = 'flops_max',
    FlopsMean = 'flops_mean',
    FlopsStd = 'flops_std',
}

export const TableHeaders: StackedTableHeader[] = [
    { label: 'Percent', key: ColumnHeaders.Percent, unit: '%', decimals: 2, sortable: true },
    { label: 'Op Code', key: ColumnHeaders.OpCodeJoined, sortable: true, filterable: true },
    { label: 'Device', key: ColumnHeaders.Device, sortable: true },
    { label: 'Device Time', key: ColumnHeaders.DeviceTimeSumUs, unit: 'µs', decimals: 2, sortable: true },
    { label: 'Ops Count', key: ColumnHeaders.OpsCount, sortable: true },
    { label: 'Min FLOPS', key: ColumnHeaders.FlopsMin, unit: '%', decimals: 2, sortable: true },
    { label: 'Max FLOPS', key: ColumnHeaders.FlopsMax, unit: '%', decimals: 2, sortable: true },
    { label: 'Mean FLOPS', key: ColumnHeaders.FlopsMean, unit: '%', decimals: 2, sortable: true },
    { label: 'Std FLOPS', key: ColumnHeaders.FlopsStd, unit: '%', decimals: 2, sortable: true },
];

export const FilterableStackedColumnKeys = TableHeaders.filter((column) => column.filterable).map(
    (column) => column.key,
);
