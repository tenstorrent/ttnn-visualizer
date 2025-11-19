// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TypedPerfTableRow } from '../definitions/PerfTable';
import isValidNumber from './isValidNumber';

function getCoreUtilization(row: TypedPerfTableRow, maxCores: number): number {
    const ideal = row.pm_ideal_ns ?? null;
    const kernelDuration = row.device_time ?? null;
    const coreCount = row.cores ?? null;

    if (!isValidNumber(ideal) || !isValidNumber(kernelDuration) || !isValidNumber(coreCount)) {
        return 0;
    }

    const kernelDurationNs = kernelDuration * 1000;
    const utilization = (ideal / kernelDurationNs) * (maxCores / coreCount);

    return isValidNumber(utilization) ? utilization : 0;
}

export default getCoreUtilization;
