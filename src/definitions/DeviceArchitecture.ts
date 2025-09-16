// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export enum DeviceArchitecture {
    UNKNOWN = '',
    GRAYSKULL = 'grayskull',
    WORMHOLE = 'wormhole_b0',
    BLACKHOLE = 'blackhole',
}

export const stringToArchitecture = (arch: string): DeviceArchitecture => {
    if (arch.toLowerCase().includes('wormhole')) {
        return DeviceArchitecture.WORMHOLE;
    }
    if (arch.toLowerCase().includes('blackhole')) {
        return DeviceArchitecture.BLACKHOLE;
    }
    return DeviceArchitecture.UNKNOWN;
};
