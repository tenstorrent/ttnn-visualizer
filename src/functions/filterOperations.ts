// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

export const isDeviceOperation = (name: string): boolean =>
    !name.includes('(torch)') && !name.includes('::') && !name.includes('ttnn.') && name !== '';

export const isExtendedDeviceOperation = (name: string): boolean =>
    !name.includes('(torch)') && (!name.includes('::') || name.includes('Tensor::')) && !name.includes('ttnn.');
