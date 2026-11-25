// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TypedPerfTableRow } from '../model/PerfTable';
import getDeviceTimeNs from './getDeviceTimeNs';
import isUnmodelledIdealTime from './isUnmodelledIdealTime';
import isValidNumber from './isValidNumber';

// Mirrored as `core_utilisation` in `backend/ttnn_visualizer/agent/perf_flags.py`.
function getCoreUtilization(row: TypedPerfTableRow, maxCores: number): number | null {
    const ideal = row.pm_ideal_ns ?? null;
    const kernelDurationNs = getDeviceTimeNs(row);
    const coreCount = row.cores ?? null;

    if (
        isUnmodelledIdealTime(ideal) ||
        !isValidNumber(ideal) ||
        !isValidNumber(kernelDurationNs) ||
        !isValidNumber(coreCount)
    ) {
        return null;
    }

    const availableCoreCount = row.available_cores ?? maxCores;
    const utilization = (ideal / kernelDurationNs) * (availableCoreCount / coreCount);

    return isValidNumber(utilization) ? utilization : null;
}

export default getCoreUtilization;
