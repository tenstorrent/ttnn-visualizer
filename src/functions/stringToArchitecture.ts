// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';

// Prefixed, not substring: descriptors carry a revision suffix (`wormhole_b0`) that has to
// resolve, but a name merely *containing* an arch must not. Cluster now enriches per chip
// from this result, so a licensee arch silently resolving to Wormhole would mislabel it. #1772
export const stringToArchitecture = (arch: string): DeviceArchitecture => {
    const name = arch.toLowerCase();
    if (name.startsWith('wormhole')) {
        return DeviceArchitecture.WORMHOLE;
    }
    if (name.startsWith('blackhole')) {
        return DeviceArchitecture.BLACKHOLE;
    }
    return DeviceArchitecture.UNKNOWN;
};
