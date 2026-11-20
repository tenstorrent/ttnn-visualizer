// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import {
    HardwareCounterAbsence,
    HardwareCounterFamily,
    HardwareCounterMeasure,
    HardwareCounterUnit,
} from '../definitions/HardwareCounters';

export interface HardwareCounterReading {
    label: string;
    measure: HardwareCounterMeasure | null;
    min: number | null;
    median: number | null;
    max: number | null;
    avg: number | null;
    absence: HardwareCounterAbsence | null;
    // What a capture must ask for, set only when the counter was not captured.
    fill_hint: string | null;
}

export interface HardwareCounterUnitReading extends HardwareCounterReading {
    unit: HardwareCounterUnit;
    family: HardwareCounterFamily;
}

export interface HardwareCounterGridReading {
    unit: HardwareCounterUnit;
    column: string;
    value: number | null;
}

export interface HardwareCounterFamilyReading {
    family: HardwareCounterFamily;
    captured: boolean;
    fill_hint: string;
    metrics: HardwareCounterReading[];
}

/** `GET /api/performance/counters/<perf_id>`. */
export interface OperationHardwareCounters {
    perf_id: number;
    has_counters: boolean;
    op_has_counters: boolean;
    architecture: DeviceArchitecture | null;
    // The row's own `DEVICE ID`: on a merged report, the one device whose row tt-perf-report kept.
    device_id: number | null;
    // Null where the CSV says nothing of the op's kernels.
    has_compute_kernel: boolean | null;
    units: HardwareCounterUnitReading[];
    full_grid: HardwareCounterGridReading[];
    families: HardwareCounterFamilyReading[];
    performance_model: { fpu_util: number | null };
}
