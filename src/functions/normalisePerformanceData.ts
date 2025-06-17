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
    otherDatasets: TypedPerfTableRow[][],
    threshold = 5,
    maxMissingRatio = 0.3,
): { data: TypedPerfTableRow[][]; missingRows: TypedPerfTableRow[] } {
    const missingRows = new Map();
    const missingCounts = new Array(otherDatasets.length).fill(0);
    const aligned: TypedPerfTableRow[][] = [[], ...otherDatasets.map(() => [])];

    let refIndex = 0;
    const otherIndexes = new Array(otherDatasets.length).fill(0);

    while (refIndex < refData.length) {
        const refRow = refData[refIndex];
        const refOp = refRow.raw_op_code;
        let allMatched = true;

        aligned[0].push({ ...refRow });

        for (let d = 0; d < otherDatasets.length; d++) {
            const dataset = otherDatasets[d];
            const j = otherIndexes[d];
            let matchFound = false;

            for (let lookahead = 0; lookahead <= threshold; lookahead++) {
                if (j + lookahead >= dataset.length) {
                    break;
                }

                const otherOp = dataset[j + lookahead].raw_op_code;

                if (otherOp === refOp) {
                    // Found match, insert MISSING for skipped ops
                    for (let k = 0; k < lookahead; k++) {
                        missingCounts[d]++;
                    }

                    aligned[d + 1].push({ ...dataset[j + lookahead] });
                    otherIndexes[d] = j + lookahead + 1;
                    matchFound = true;
                    break;
                }
            }

            if (!matchFound) {
                missingCounts[d]++;
                allMatched = false;
                aligned[d + 1].push({
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
            const opCode = `${MISSING_PREFIX} ${largestArr[arr.length]?.op_code}`;
            const rawOpCode = `${MISSING_PREFIX} ${largestArr[arr.length]?.raw_op_code}`;
            const id = largestArr[arr.length]?.id;

            arr.push({ ...PLACEHOLDER, id, op_code: opCode, raw_op_code: rawOpCode });
        }
    }

    // Discard datasets with too many missing rows
    for (let d = 0; d < otherDatasets.length; d++) {
        const ratio = missingCounts[d] / maxLen;
        if (ratio > maxMissingRatio) {
            aligned[d + 1] = [];
        }
    }

    return {
        data: aligned,
        missingRows: Array.from(missingRows.values()),
    };
}

export default alignByOpCode;
