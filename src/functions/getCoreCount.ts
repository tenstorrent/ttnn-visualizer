// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import { PerfTableRow, TypedPerfTableRow } from '../definitions/PerfTable';

const CORE_COUNT = {
    grayskull: 108,
    wormhole_b0: 64,
};

function getCoreCount(architecture: DeviceArchitecture, data: PerfTableRow[] | TypedPerfTableRow[]): number {
    const highestCoreCount = Math.max(
        ...data
            .filter((row) => row.cores)
            .map((row) => {
                const { cores } = row;

                if (typeof cores === 'string') {
                    const parsed = parseInt(cores, 10);
                    return Number.isNaN(parsed) ? 0 : parsed;
                }
                return cores ?? 0;
            }),
    );

    // @ts-expect-error no blackhole yet
    return highestCoreCount > CORE_COUNT[architecture] ? highestCoreCount : CORE_COUNT[architecture];
}

export default getCoreCount;
