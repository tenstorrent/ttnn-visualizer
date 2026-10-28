// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import archBlackhole from '../assets/data/arch-blackhole.json';
import archGrendel from '../assets/data/arch-grendel.json';
import archQuasarQsr3a2 from '../assets/data/arch-quasar-qsr3a2.json';
import archQuasar from '../assets/data/arch-quasar.json';
import archWormhole from '../assets/data/arch-wormhole.json';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import { ChipDesign } from '../model/ClusterModel';

const NO_DESIGNS: readonly ChipDesign[] = [];

// The default first: it is the one assumed when no grid picks another. One arch name can cover
// several parts, as QSR3.A2 reports `quasar` like Quasar-32, so only the grid tells them apart. #2237
const BAKED_DESIGNS_BY_ARCH = new Map<DeviceArchitecture, readonly ChipDesign[]>([
    [DeviceArchitecture.WORMHOLE, [archWormhole as ChipDesign]],
    [DeviceArchitecture.BLACKHOLE, [archBlackhole as ChipDesign]],
    [
        DeviceArchitecture.QUASAR,
        [
            // Quasar-32 from tt-metal `soc_descriptors/quasar_32_arch.yaml` at 7d54a363f0c: Tensix-only emulation. #1847
            archQuasar as ChipDesign,
            // QSR3.A2, three Quasar dies in one NoC space, from `quasar_qsr3a2_arch.yaml` at 252c3e74847. #2237
            archQuasarQsr3a2 as ChipDesign,
        ],
    ],
    // Grendel as the qsr.s1 ATT map addresses it (tt-umd a5d92b1e58b; dispatch from tt-metal's grendel_qsr1_att_config.h,
    // grid from GRID_SIZE), with no Ethernet or PCIe. Check it against a published layout before relying on it. #2130
    [DeviceArchitecture.GRENDEL, [archGrendel as ChipDesign]],
]);

/** Every baked descriptor with its arch, each arch's default first. */
export const getAllBakedChipDesigns = (): { arch: DeviceArchitecture; design: ChipDesign }[] =>
    [...BAKED_DESIGNS_BY_ARCH].flatMap(([arch, designs]) => designs.map((design) => ({ arch, design })));

/** Every descriptor baked for `arch`, its default first. */
export const getBakedChipDesigns = (arch: DeviceArchitecture): readonly ChipDesign[] =>
    BAKED_DESIGNS_BY_ARCH.get(arch) ?? NO_DESIGNS;

// `null` rather than an empty-object stand-in: `ChipDesign` declares `arch_name`, `grid`,
// `eth` and `pcie` as required, so a stand-in claims fields it doesn't have and pushes every
// reader into optional chaining against a non-optional type. `design === null` is now the one
// predicate for "did the arch resolve?", and it is as stable an identity across renders as a
// frozen object, which consumers memoising on the descriptor rely on. #1772
/** The default descriptor baked for `arch`, for a caller with no grid to choose by. */
export const getChipDesign = (arch: DeviceArchitecture): ChipDesign | null => getBakedChipDesigns(arch)[0] ?? null;

/** The descriptor baked for `arch` on exactly `grid`, or null when none is. */
export const findBakedChipDesign = (arch: DeviceArchitecture, grid: ChipDesign['grid']): ChipDesign | null =>
    getBakedChipDesigns(arch).find(
        (design) => design.grid.x_size === grid.x_size && design.grid.y_size === grid.y_size,
    ) ?? null;
