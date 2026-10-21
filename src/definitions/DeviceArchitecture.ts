// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum DeviceArchitecture {
    UNKNOWN = '',
    GRAYSKULL = 'grayskull',
    WORMHOLE = 'wormhole_b0',
    BLACKHOLE = 'blackhole',
    QUASAR = 'quasar',
    // Nothing emits this: UMD marks Grendel as `quasar` with an optional `ip_variant` (tt-umd#3587), so
    // using its descriptor for real reports would key on that variant and the grid instead. #2130
    GRENDEL = 'grendel',
}
