// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OpType } from './Performance';

enum OperationCategories {
    Compute = 'Compute',
    DM = 'DM',
    TM = 'TM',
}

export enum StackedColumnHeaders {
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

export type StackedTableKeys = Partial<keyof StackedPerfRow>;

export type StackedTableFilter = Record<StackedTableKeys, string> | null;

export interface StackedTableColumn {
    label: string;
    key: StackedTableKeys;
    colour?: string;
    unit?: string;
    decimals?: number;
    sortable?: boolean;
    filterable?: boolean;
}

export interface StackedPerfRow {
    [StackedColumnHeaders.Percent]: string;
    [StackedColumnHeaders.OpCode]: string;
    [StackedColumnHeaders.Device]: string;
    [StackedColumnHeaders.DeviceTimeSumUs]: string;
    [StackedColumnHeaders.OpsCount]: string;
    [StackedColumnHeaders.OpCategory]: OperationCategories;
    [StackedColumnHeaders.FlopsMin]: string;
    [StackedColumnHeaders.FlopsMax]: string;
    [StackedColumnHeaders.FlopsMean]: string;
    [StackedColumnHeaders.FlopsStd]: string;
    [StackedColumnHeaders.FlopsWeightedMean]: string;
    op_type: OpType;
}

export interface TypedStackedPerfRow
    extends Omit<
        StackedPerfRow,
        | StackedColumnHeaders.Percent
        | StackedColumnHeaders.Device
        | StackedColumnHeaders.DeviceTimeSumUs
        | StackedColumnHeaders.OpsCount
        | StackedColumnHeaders.OpCategory
        | StackedColumnHeaders.FlopsMin
        | StackedColumnHeaders.FlopsMax
        | StackedColumnHeaders.FlopsMean
        | StackedColumnHeaders.FlopsStd
        | StackedColumnHeaders.FlopsWeightedMean
    > {
    [StackedColumnHeaders.Percent]: number | null;
    [StackedColumnHeaders.Device]: number | null;
    [StackedColumnHeaders.DeviceTimeSumUs]: number | null;
    [StackedColumnHeaders.OpsCount]: number | null;
    [StackedColumnHeaders.FlopsMin]: number | null;
    [StackedColumnHeaders.FlopsMax]: number | null;
    [StackedColumnHeaders.FlopsMean]: number | null;
    [StackedColumnHeaders.FlopsStd]: number | null;
    [StackedColumnHeaders.FlopsWeightedMean]: number | null;
    [StackedColumnHeaders.OpCategory]: OperationCategories;
}

export const stackedTableColumns: StackedTableColumn[] = [
    { label: 'Percent', key: StackedColumnHeaders.Percent, unit: '%', decimals: 2, sortable: true },
    { label: 'Op Code', key: StackedColumnHeaders.OpCode, sortable: true, filterable: true },
    { label: 'Device', key: StackedColumnHeaders.Device, decimals: 0, sortable: true },
    { label: 'Device Time', key: StackedColumnHeaders.DeviceTimeSumUs, unit: 'µs', decimals: 2, sortable: true },
    { label: 'Ops Count', key: StackedColumnHeaders.OpsCount, sortable: true },
    { label: 'Op Category', key: StackedColumnHeaders.OpCategory, sortable: true, filterable: true },
    { label: 'Min FLOPS', key: StackedColumnHeaders.FlopsMin, unit: '%', decimals: 2, sortable: true },
    { label: 'Max FLOPS', key: StackedColumnHeaders.FlopsMax, unit: '%', decimals: 2, sortable: true },
    { label: 'Mean FLOPS', key: StackedColumnHeaders.FlopsMean, unit: '%', decimals: 2, sortable: true },
    { label: 'Std FLOPS', key: StackedColumnHeaders.FlopsStd, unit: '%', decimals: 2, sortable: true },
    {
        label: 'Weighted Mean FLOPS',
        key: StackedColumnHeaders.FlopsWeightedMean,
        unit: '%',
        decimals: 2,
        sortable: true,
    },
];

export const filterableStackedColumnKeys = stackedTableColumns
    .filter((column) => column.filterable)
    .map((column) => column.key);
