// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

export const isDeviceOperation = (name: string): boolean =>
    !name.includes('(torch)') && !name.includes('::') && !name.includes('ttnn.') && name !== '';
