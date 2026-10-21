// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import archBlackhole from '../assets/data/arch-blackhole.json';
import archGrendel from '../assets/data/arch-grendel.json';
import archQuasar from '../assets/data/arch-quasar.json';
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
        // Quasar-32 from tt-metal `soc_descriptors/quasar_32_arch.yaml` at 7d54a363f0c: Tensix-only emulation. #1847
        case DeviceArchitecture.QUASAR:
            return archQuasar as ChipDesign;
        // Grendel as the qsr.s1 ATT map addresses it (tt-umd a5d92b1e58b; dispatch from tt-metal's grendel_qsr1_att_config.h,
        // grid from GRID_SIZE), with no Ethernet or PCIe. Check it against a published layout before relying on it. #2130
        case DeviceArchitecture.GRENDEL:
            return archGrendel as ChipDesign;
        default:
            return null;
    }
};
