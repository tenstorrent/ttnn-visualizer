// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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

const MISSING_PREFIX = 'MISSING -';

function alignByOpCode(
    refData: TypedPerfTableRow[],
    dataToAlign: TypedPerfTableRow[][],
    threshold = 5,
    maxMissingRatio = 0.3,
): { data: TypedPerfTableRow[][]; missingRows: TypedPerfTableRow[] } {
    const missingRows = new Map();
    const missingCounts = new Array(dataToAlign.length).fill(0); // Tracks how many placeholder rows have been inserted for each dataset
    const currentIndexes = new Array(dataToAlign.length).fill(0); // Tracks the current index/position in each dataset as the alignment proceeds.
    const aligned: TypedPerfTableRow[][] = [[], ...dataToAlign.map(() => [])];

    let refIndex = 0;

    while (refIndex < refData.length) {
        const refRow = refData[refIndex];
        const refOp = refRow.raw_op_code;
        let allMatched = true;

        aligned[0].push({ ...refRow });

        for (let dataIndex = 0; dataIndex < dataToAlign.length; dataIndex++) {
            const dataset = dataToAlign[dataIndex];
            const currentIndex = currentIndexes[dataIndex];
            let matchFound = false;

            for (let lookahead = 0; lookahead <= threshold; lookahead++) {
                if (currentIndex + lookahead >= dataset.length) {
                    break;
                }

                const otherOp = dataset[currentIndex + lookahead].raw_op_code;

                if (otherOp === refOp) {
                    // Found match, insert MISSING for skipped ops
                    for (let current = 0; current < lookahead; current++) {
                        missingCounts[dataIndex]++;
                    }

                    aligned[dataIndex + 1].push({ ...dataset[currentIndex + lookahead] });
                    currentIndexes[dataIndex] = currentIndex + lookahead + 1;
                    matchFound = true;
                    break;
                }
            }

            if (!matchFound) {
                missingCounts[dataIndex]++;
                allMatched = false;
                aligned[dataIndex + 1].push({
                    ...PLACEHOLDER,
                    op_code: `${MISSING_PREFIX} ${refOp}`,
                    raw_op_code: `${MISSING_PREFIX} ${refOp}`,
                });
            }
        }

        if (!allMatched && !missingRows.has(refOp)) {
            missingRows.set(refOp, refRow);
        }

        refIndex++;
    }

    // Padding to ensure all arrays are same length
    const maxLen = Math.max(...aligned.map((arr) => arr.length));
    for (const arr of aligned) {
        while (arr.length < maxLen) {
            const largestArr = aligned.reduce((a, b) => (a.length > b.length ? a : b));

            const id = largestArr[arr.length]?.id || null;
            const opCode = largestArr[arr.length]?.op_code || '';
            const rawOpCode = largestArr[arr.length]?.raw_op_code || '';

            const opCodeMessage = `${MISSING_PREFIX} ${opCode}`;
            const rawOpCodeMessage = `${MISSING_PREFIX} ${rawOpCode}`;

            arr.push({ ...PLACEHOLDER, id, op_code: opCodeMessage, raw_op_code: rawOpCodeMessage });
        }
    }

    // Discard datasets with too many missing rows
    for (let dataIndex = 0; dataIndex < dataToAlign.length; dataIndex++) {
        const ratio = missingCounts[dataIndex] / maxLen;
        if (ratio > maxMissingRatio) {
            aligned[dataIndex + 1] = [];
        }
    }

    return {
        data: aligned,
        missingRows: [...missingRows.values()],
    };
}

export default alignByOpCode;
