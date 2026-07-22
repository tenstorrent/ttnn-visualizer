// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/**
 * Disambiguate a report name within a batch, mirroring the backend
 * `_unique_mlir_name` helper. If `base` already exists in `used`, the
 * function appends ` (2)`, ` (3)`, … until the name is unique, then
 * records the chosen name in `used` as a side-effect so the next call
 * in the same batch sees it.
 */
const uniqueMlirName = (base: string, used: Set<string>): string => {
    const stem = base || 'model';
    let name = stem;
    let counter = 2;
    while (used.has(name)) {
        name = `${stem} (${counter})`;
        counter += 1;
    }
    used.add(name);
    return name;
};

export default uniqueMlirName;
