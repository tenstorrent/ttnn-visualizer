// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import archBlackhole from '../assets/data/arch-blackhole.json';
import archWormhole from '../assets/data/arch-wormhole.json';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import { ChipDesign } from '../model/ClusterModel';

// `null` rather than an empty-object stand-in: `ChipDesign` declares `arch_name`, `grid`,
// `eth` and `pcie` as required, so a stand-in claims fields it doesn't have and pushes every
// reader into optional chaining against a non-optional type. `design === null` is now the one
// predicate for "did the arch resolve?", and it is as stable an identity across renders as a
// frozen object, which consumers memoising on the descriptor rely on. #1772
export const getChipDesign = (arch: DeviceArchitecture): ChipDesign | null => {
    switch (arch) {
        case DeviceArchitecture.WORMHOLE:
            return archWormhole as ChipDesign;
        case DeviceArchitecture.BLACKHOLE:
            return archBlackhole as ChipDesign;
        default:
            return null;
    }
};
