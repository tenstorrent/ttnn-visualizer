// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

// Whole point of this function is to check if the value is a number so 'any' is appropriate
const isValidNumber = (value: unknown) => Number.isFinite(value);

export default isValidNumber;
