// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceArchitecture } from '../definitions/DeviceArchitecture';

// Takes `unknown`, not `string`: the only caller reads an uploaded cluster descriptor that
// reaches us via `yaml.safe_load` with no schema validation, and YAML readily yields an int
// or a nested map for `arch`. A non-string reaching `.toLowerCase()` throws, and the nearest
// boundary is the router's root `errorElement`, which replaces the whole app shell. Treating
// it as unresolved matches how an unrecognised arch already degrades — enrichment is lost,
// placement and links are not. #1772
export const stringToArchitecture = (arch: unknown): DeviceArchitecture => {
    if (typeof arch !== 'string') {
        return DeviceArchitecture.UNKNOWN;
    }
    const name = arch.toLowerCase();
    if (name.startsWith('wormhole')) {
        return DeviceArchitecture.WORMHOLE;
    }
    if (name.startsWith('blackhole')) {
        return DeviceArchitecture.BLACKHOLE;
    }
    return DeviceArchitecture.UNKNOWN;
};
