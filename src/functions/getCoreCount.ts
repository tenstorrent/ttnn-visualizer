// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { RowData } from '../definitions/PerfTable';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';

const CORE_COUNT = {
    grayskull: 108,
    wormhole_b0: 64,
};

function getCoreCount(architecture: DeviceArchitecture, data: RowData[]): number {
    const highestCoreCount = Math.max(
        ...data.filter((row) => row['CORE COUNT']).map((row) => parseInt(row['CORE COUNT'] ?? '0', 10)),
    );

    // @ts-expect-error no blackhole yet
    return highestCoreCount > CORE_COUNT[architecture] ? highestCoreCount : CORE_COUNT[architecture];
}

export default getCoreCount;
