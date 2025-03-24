// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PerfTableRow } from '../definitions/PerfTable';
import isValidNumber from './isValidNumber';

function getCoreUtilization(row: PerfTableRow, maxCores: number): number {
    const ideal = row.pm_ideal_ns ? parseInt(row.pm_ideal_ns, 10) : null;
    const kernelDuration = row.device_time ? parseInt(row.device_time, 10) : null;
    const coreCount = row.cores ? parseInt(row.cores, 10) : null;

    if (!isValidNumber(ideal) || !isValidNumber(kernelDuration) || !isValidNumber(coreCount)) {
        return 0;
    }

    return (ideal / kernelDuration) * (maxCores / coreCount);
}

export default getCoreUtilization;
