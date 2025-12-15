// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import { TypedPerfTableRow } from '../definitions/PerfTable';

// Core counts don't match documentation exactly because there are 1 or 2 rows of harvested cores, so they are not considered as working cores
const CORE_COUNT = {
    grayskull: 108,
    wormhole_b0: 64,
    // blackhole: 120/140 - https://tenstorrent.com/hardware/wormhole has two models, need to confirm logic
};

function getCoreCount(architecture: DeviceArchitecture, data: TypedPerfTableRow[]): number {
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
