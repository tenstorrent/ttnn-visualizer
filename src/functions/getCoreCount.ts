// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PerfTableRow } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';

const CORE_COUNT = {
    grayskull: 108,
    wormhole_b0: 64,
};

function getCoreCount(architecture: DeviceArchitecture, data: PerfTableRow[]): number {
    const highestCoreCount = Math.max(...data.filter((row) => row.cores).map((row) => parseInt(row.cores ?? '0', 10)));

    // @ts-expect-error no blackhole yet
    return highestCoreCount > CORE_COUNT[architecture] ? highestCoreCount : CORE_COUNT[architecture];
}

export default getCoreCount;
