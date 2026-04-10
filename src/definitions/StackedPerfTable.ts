// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OpType } from './Performance';

enum OperationCategories {
    Compute = 'Compute',
    DM = 'DM',
    TM = 'TM',
}

export enum StackedColumnKeys {
    Percent = '%',
    OpCode = 'op_code',
    Device = 'Device',
    DeviceTimeSumUs = 'Device_Time_Sum_us',
    OpsCount = 'Ops_count',
    OpCategory = 'Op_Category',
    FlopsMin = 'Flops_min',
    FlopsMax = 'Flops_max',
    FlopsMean = 'Flops_mean',
    FlopsStd = 'Flops_std',
    FlopsWeightedMean = 'Flops_weighted_mean',
}

export enum StackedGroupBy {
    CATEGORY = 'category',
    MEMORY = 'memory',
    OP = 'operation',
}

export interface StackedTableColumn {
    label: string;
    key: StackedColumnKeys;
    colour?: string;
    unit?: string;
    decimals?: number;
    sortable?: boolean;
    filterable?: boolean;
}

export interface StackedPerfRow {
    '%': string;
    op_code: string;
    Device: string;
    Device_Time_Sum_us: string;
    Ops_count: string;
    Op_Category: OperationCategories;
    Flops_min: string;
    Flops_max: string;
    Flops_mean: string;
    Flops_std: string;
    Flops_weighted_mean: string;
    op_type: OpType;
}

export interface TypedStackedPerfRow extends Omit<
    StackedPerfRow,
    | '%'
    | 'Device'
    | 'Device_Time_Sum_us'
    | 'Ops_count'
    | 'Op_Category'
    | 'Flops_min'
    | 'Flops_max'
    | 'Flops_mean'
    | 'Flops_std'
    | 'Flops_weighted_mean'
> {
    '%': number | null;
    Device: number | null;
    Device_Time_Sum_us: number | null;
    Ops_count: number | null;
    Flops_min: number | null;
    Flops_max: number | null;
    Flops_mean: number | null;
    Flops_std: number | null;
    Flops_weighted_mean: number | null;
    Op_Category: OperationCategories;
}

export const stackedTableColumns: StackedTableColumn[] = [
    { label: 'Total %', key: StackedColumnKeys.Percent, unit: '%', decimals: 2, sortable: true },
    { label: 'Op Code', key: StackedColumnKeys.OpCode, sortable: true, filterable: true },
    { label: 'Device', key: StackedColumnKeys.Device, decimals: 0, sortable: true },
    { label: 'Device Time', key: StackedColumnKeys.DeviceTimeSumUs, unit: 'µs', decimals: 2, sortable: true },
    { label: 'Ops Count', key: StackedColumnKeys.OpsCount, sortable: true },
    { label: 'Op Category', key: StackedColumnKeys.OpCategory, sortable: true, filterable: true },
    { label: 'Min FLOPS', key: StackedColumnKeys.FlopsMin, unit: '%', decimals: 2, sortable: true },
    { label: 'Max FLOPS', key: StackedColumnKeys.FlopsMax, unit: '%', decimals: 2, sortable: true },
    { label: 'Mean FLOPS', key: StackedColumnKeys.FlopsMean, unit: '%', decimals: 2, sortable: true },
    { label: 'Std FLOPS', key: StackedColumnKeys.FlopsStd, unit: '%', decimals: 2, sortable: true },
    {
        label: 'Weighted Mean FLOPS',
        key: StackedColumnKeys.FlopsWeightedMean,
        unit: '%',
        decimals: 2,
        sortable: true,
    },
];

export const filterableStackedColumnKeys = stackedTableColumns
    .filter((column) => column.filterable)
    .map((column) => column.key);

export type StackedTableFilter = Record<StackedColumnKeys, string> | null;
