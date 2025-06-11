// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { TypedPerfTableRow } from './sortAndFilterPerfTableData';

const PLACEHOLDER: TypedPerfTableRow = {
    id: null,
    advice: [],
    total_percent: null,
    bound: '',
    op_code: 'MISSING',
    raw_op_code: 'MISSING',
    device_time: null,
    op_to_op_gap: null,
    cores: null,
    dram: null,
    dram_percent: null,
    flops: null,
    flops_percent: null,
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

const MISSING_ROWS: TypedPerfTableRow[] = [];
const MISSING_PREFIX = 'MISSING - ';

function normalisePerformanceData(
    primaryData: TypedPerfTableRow[],
    comparisonData: TypedPerfTableRow[][],
): [TypedPerfTableRow[], TypedPerfTableRow[][]] {
    MISSING_ROWS.length = 0; // Clear array
    const result1: TypedPerfTableRow[] = [];
    const result2: TypedPerfTableRow[][] = [];

    let i = 0;
    let j = 0;

    comparisonData.forEach((cData) => {
        const cDataArray = [];

        while (i < primaryData.length && j < cData.length) {
            const item1 = primaryData[i];
            const item2 = cData[j];
            const code1 = item1.raw_op_code;
            const code2 = item2.raw_op_code;

            // Op code match, continue on
            if (code1 === code2) {
                result1.push(item1);
                cDataArray.push(item2);
                i++;
                j++;
            } else {
                // Look ahead to find matching op_code in remaining items
                const nextMatchIn1 = cData.slice(i + 1).findIndex((el) => el.raw_op_code === code2);
                const nextMatchIn2 = cData.slice(j + 1).findIndex((el) => el.raw_op_code === code1);

                const indexIn1 = nextMatchIn1 >= 0 ? i + 1 + nextMatchIn1 : null;
                const indexIn2 = nextMatchIn2 >= 0 ? j + 1 + nextMatchIn2 : null;

                if (indexIn1 !== null && (indexIn2 === null || indexIn1 - i <= indexIn2 - j)) {
                    // Add placeholders until match is found (primaryData)
                    while (i < indexIn1) {
                        if (primaryData[i]) {
                            result1.push(primaryData[i]);
                            cDataArray.push({
                                ...PLACEHOLDER,
                                op_code: `${MISSING_PREFIX} ${primaryData[i].raw_op_code}`,
                            });
                            MISSING_ROWS.push(primaryData[i]);
                        }

                        i++;
                    }
                } else if (indexIn2 !== null) {
                    // Add placeholders until match is found (cData)
                    while (j < indexIn2) {
                        cDataArray.push(cData[j]);
                        result1.push({ ...PLACEHOLDER, op_code: `${MISSING_PREFIX} ${cData[j].raw_op_code}` });
                        MISSING_ROWS.push(cData[j]);
                        j++;
                    }
                } else {
                    // No match found
                    result1.push(item1);
                    cDataArray.push(item2);
                    i++;
                    j++;
                }
            }
        }

        // Fill any remaining items
        while (i < primaryData.length) {
            result1.push(primaryData[i]);
            cDataArray.push({ ...PLACEHOLDER, op_code: `${MISSING_PREFIX} ${primaryData[i].raw_op_code}` });
            MISSING_ROWS.push(primaryData[i]);
            i++;
        }

        // Fill any remaining items
        while (j < cData.length) {
            result1.push(PLACEHOLDER);
            cDataArray.push({ ...PLACEHOLDER, op_code: `${MISSING_PREFIX} ${cData[j].raw_op_code}` });
            MISSING_ROWS.push(cData[j]);
            j++;
        }

        result2.push(cDataArray);
    });

    return [result1, result2];
}

export default normalisePerformanceData;
export { MISSING_ROWS };
