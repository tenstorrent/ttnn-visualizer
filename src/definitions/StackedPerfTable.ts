// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OpType } from './Performance';

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

enum OperationCategories {
    Compute = 'Compute',
    DM = 'DM',
    TM = 'TM',
}

export interface StackedPerfRow {
    ['%']: string;
    ['OP Code Joined']: string;
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

export interface TypedStackedPerfRow
    extends Omit<
        StackedPerfRow,
        | '%'
        | 'Device'
        | 'Device_Time_Sum_us'
        | 'Ops_count'
        | 'Flops_min'
        | 'Flops_max'
        | 'Flops_mean'
        | 'Flops_std'
        | 'Flops_weighted_mean'
    > {
    ['%']: number | null;
    Device: number | null;
    Device_Time_Sum_us: number | null;
    Ops_count: number | null;
    Flops_min: number | null;
    Flops_max: number | null;
    Flops_mean: number | null;
    Flops_std: number | null;
    Flops_weighted_mean: number | null;
}

export enum StackedColumnHeaders {
    Percent = '%',
    OpCode = 'OP Code Joined',
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
