// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { PerfTableRow } from '../definitions/PerfTable';
import isValidNumber from './isValidNumber';

function getCoreUtilization(row: PerfTableRow, maxCores: number): number {
    const ideal = row.pm_ideal_ns ? parseFloat(row.pm_ideal_ns) : null;
    const kernelDuration = row.device_time ? parseFloat(row.device_time) : null;
    const coreCount = row.cores ? parseInt(row.cores, 10) : null;

    if (!isValidNumber(ideal) || !isValidNumber(kernelDuration) || !isValidNumber(coreCount)) {
        return 0;
    }

    const kernelDurationNs = kernelDuration * 1000;
    const utilization = (ideal / kernelDurationNs) * (maxCores / coreCount);

    return isValidNumber(utilization) ? utilization : 0;
}

export default getCoreUtilization;
