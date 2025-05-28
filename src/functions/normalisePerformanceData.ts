// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { PerfTableRow } from '../definitions/PerfTable';

const PLACEHOLDER: PerfTableRow = {
    id: '',
    advice: [],
    total_percent: '',
    bound: '',
    op_code: 'MISSING',
    raw_op_code: 'MISSING',
    device_time: '',
    op_to_op_gap: '',
    cores: '',
    dram: '',
    dram_percent: '',
    flops: '',
    flops_percent: '',
    math_fidelity: '',
    output_datatype: '',
    output_0_memory: '',
    input_0_datatype: '',
    input_1_datatype: '',
    dram_sharded: '',
    input_0_memory: '',
    input_1_memory: '',
    inner_dim_block_size: '',
    output_subblock_h: '',
    output_subblock_w: '',
    pm_ideal_ns: '',
};

const MISSING_ROWS: PerfTableRow[] = [];
const MISSING_PREFIX = 'MISSING - ';

function normalisePerformanceData(arr1: PerfTableRow[], arr2: PerfTableRow[]) {
    MISSING_ROWS.length = 0; // Clear array
    const result1 = [];
    const result2 = [];

    let i = 0;
    let j = 0;

    while (i < arr1.length && j < arr2.length) {
        const item1 = arr1[i];
        const item2 = arr2[j];
        const code1 = item1.raw_op_code;
        const code2 = item2.raw_op_code;

        // Op code match, continue on
        if (code1 === code2) {
            result1.push(item1);
            result2.push(item2);
            i++;
            j++;
        } else {
            // Look ahead to find matching op_code in remaining items
            const nextMatchIn1 = arr1.slice(i + 1).findIndex((el) => el.raw_op_code === code2);
            const nextMatchIn2 = arr2.slice(j + 1).findIndex((el) => el.raw_op_code === code1);

            const indexIn1 = nextMatchIn1 >= 0 ? i + 1 + nextMatchIn1 : null;
            const indexIn2 = nextMatchIn2 >= 0 ? j + 1 + nextMatchIn2 : null;

            if (indexIn1 !== null && (indexIn2 === null || indexIn1 - i <= indexIn2 - j)) {
                // Add placeholders until match is found (arr1)
                while (i < indexIn1) {
                    result1.push(arr1[i]);
                    result2.push({ ...PLACEHOLDER, op_code: `${MISSING_PREFIX} ${arr1[i].raw_op_code}` });
                    MISSING_ROWS.push(arr1[i]);
                    i++;
                }
            } else if (indexIn2 !== null) {
                // Add placeholders until match is found (arr2)
                while (j < indexIn2) {
                    result2.push(arr2[j]);
                    result1.push({ ...PLACEHOLDER, op_code: `${MISSING_PREFIX} ${arr2[j].raw_op_code}` });
                    MISSING_ROWS.push(arr2[j]);
                    j++;
                }
            } else {
                // No match found
                result1.push(item1);
                result2.push(item2);
                i++;
                j++;
            }
        }
    }

    // Fill any remaining items (arr1)
    while (i < arr1.length) {
        result1.push(arr1[i]);
        result2.push({ ...PLACEHOLDER, op_code: `${MISSING_PREFIX} ${arr1[i].raw_op_code}` });
        MISSING_ROWS.push(arr1[i]);
        i++;
    }

    // Fill any remaining items (arr2)
    while (j < arr2.length) {
        result1.push(PLACEHOLDER);
        result2.push({ ...PLACEHOLDER, op_code: `${MISSING_PREFIX} ${arr2[j].raw_op_code}` });
        MISSING_ROWS.push(arr2[j]);
        j++;
    }

    return [result1, result2];
}

export default normalisePerformanceData;
export { MISSING_ROWS };
