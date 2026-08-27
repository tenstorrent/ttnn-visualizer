// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import { TypedPerfTableRow } from '../model/PerfTable';

// Core counts don't match documentation exactly because there are 1 or 2 rows of harvested cores, so they are not considered as working cores
const CORE_COUNT: Record<Exclude<DeviceArchitecture, DeviceArchitecture.UNKNOWN>, number> = {
    [DeviceArchitecture.GRAYSKULL]: 108,
    [DeviceArchitecture.WORMHOLE]: 64,
    [DeviceArchitecture.BLACKHOLE]: 130, // Mohamed: 130 for BH p150 and 120 for BH p100. P150 is more popular so 130 is good
};

// Wormhole default used when device metadata is unavailable (matches DeviceArchitecture.WORMHOLE).
export const DEFAULT_MAX_CORES = CORE_COUNT[DeviceArchitecture.WORMHOLE];

export interface DeviceMetaLike {
    architecture?: DeviceArchitecture | null;
    max_cores?: number | null;
}

function getArchitectureDefaultCores(architecture: DeviceArchitecture): number {
    if (architecture === DeviceArchitecture.UNKNOWN) {
        return DEFAULT_MAX_CORES;
    }

    return CORE_COUNT[architecture];
}

function getCoreCount(architecture: DeviceArchitecture, data: TypedPerfTableRow[]): number {
    const architectureDefault = getArchitectureDefaultCores(architecture);
    let highestCoreCount = 0;

    for (const row of data) {
        const { cores } = row;

        if (cores != null) {
            const parsed = typeof cores === 'string' ? parseInt(cores, 10) : cores;

            if (!Number.isNaN(parsed) && parsed > highestCoreCount) {
                highestCoreCount = parsed;
            }
        }
    }

    return highestCoreCount > architectureDefault ? highestCoreCount : architectureDefault;
}

/** Resolve device capacity for utilisation heuristics and UI core count display. */
export function resolveMaxCores(deviceMeta: DeviceMetaLike | null | undefined, rows: TypedPerfTableRow[]): number {
    const architecture = deviceMeta?.architecture ?? DeviceArchitecture.WORMHOLE;
    const maxCores = deviceMeta?.max_cores ?? getCoreCount(architecture, rows);

    return maxCores > 0 ? maxCores : DEFAULT_MAX_CORES;
}

export default getCoreCount;
