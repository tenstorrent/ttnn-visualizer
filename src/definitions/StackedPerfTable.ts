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
    [StackedColumnKeys.Percent]: string;
    [StackedColumnKeys.OpCode]: string;
    [StackedColumnKeys.Device]: string;
    [StackedColumnKeys.DeviceTimeSumUs]: string;
    [StackedColumnKeys.OpsCount]: string;
    [StackedColumnKeys.OpCategory]: OperationCategories;
    [StackedColumnKeys.FlopsMin]: string;
    [StackedColumnKeys.FlopsMax]: string;
    [StackedColumnKeys.FlopsMean]: string;
    [StackedColumnKeys.FlopsStd]: string;
    [StackedColumnKeys.FlopsWeightedMean]: string;
    op_type: OpType;
}

export interface TypedStackedPerfRow extends Omit<
    StackedPerfRow,
    | StackedColumnKeys.Percent
    | StackedColumnKeys.Device
    | StackedColumnKeys.DeviceTimeSumUs
    | StackedColumnKeys.OpsCount
    | StackedColumnKeys.OpCategory
    | StackedColumnKeys.FlopsMin
    | StackedColumnKeys.FlopsMax
    | StackedColumnKeys.FlopsMean
    | StackedColumnKeys.FlopsStd
    | StackedColumnKeys.FlopsWeightedMean
> {
    [StackedColumnKeys.Percent]: number | null;
    [StackedColumnKeys.Device]: number | null;
    [StackedColumnKeys.DeviceTimeSumUs]: number | null;
    [StackedColumnKeys.OpsCount]: number | null;
    [StackedColumnKeys.OpCategory]: OperationCategories;
    [StackedColumnKeys.FlopsMin]: number | null;
    [StackedColumnKeys.FlopsMax]: number | null;
    [StackedColumnKeys.FlopsMean]: number | null;
    [StackedColumnKeys.FlopsStd]: number | null;
    [StackedColumnKeys.FlopsWeightedMean]: number | null;
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

export type StackedTableFilter = Partial<Record<StackedColumnKeys, string>> | null;
