// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

// Whole point of this function is to check if the value is a number so 'any' is appropriate
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isValidNumber = (value: any): value is number => Number.isFinite(value);

export default isValidNumber;
