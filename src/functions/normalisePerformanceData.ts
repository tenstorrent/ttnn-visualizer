// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { TypedPerfTableRow } from './sortAndFilterPerfTableData';

const MISSING_OP_STRING = 'MISSING';
const PLACEHOLDER: TypedPerfTableRow = {
    id: null,
    global_call_count: null,
    advice: [],
    total_percent: null,
    bound: '',
    op_code: MISSING_OP_STRING,
    raw_op_code: MISSING_OP_STRING,
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

function alignByOpCode(
    refData: TypedPerfTableRow[],
    dataToAlign: TypedPerfTableRow[][],
    threshold = 5,
    maxMissingRatio = 0.3,
): { data: TypedPerfTableRow[][]; missingRows: TypedPerfTableRow[] } {
    const missingRows = new Map<string, TypedPerfTableRow>();
    const missingCounts = Array(dataToAlign.length).fill(0); // Tracks how many placeholder rows have been inserted for each dataset
    const currentIndexes = Array(dataToAlign.length).fill(0); // Tracks the current index/position in each dataset as the alignment proceeds
    // aligned[0] is the reference, aligned[1..n] are the datasets
    const aligned: TypedPerfTableRow[][] = [[], ...dataToAlign.map(() => [])];

    for (let refIndex = 0; refIndex < refData.length; refIndex++) {
        const refRow = refData[refIndex];
        const refOp = refRow.raw_op_code;
        let allMatched = true;

        aligned[0].push(refRow);

        for (let dataIndex = 0; dataIndex < dataToAlign.length; dataIndex++) {
            const dataset = dataToAlign[dataIndex];
            const currentIndex = currentIndexes[dataIndex];
            let matchFound = false;

            for (let lookahead = 0; lookahead <= threshold && currentIndex + lookahead < dataset.length; lookahead++) {
                const candidate = dataset[currentIndex + lookahead];

                if (candidate.raw_op_code === refOp) {
                    // Insert MISSING for skipped ops (if any)
                    missingCounts[dataIndex] += lookahead;
                    aligned[dataIndex + 1].push(candidate);
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
                    op_code: getMissingOpPrefix(refOp),
                    raw_op_code: getMissingOpPrefix(refOp),
                });
            }
        }

        if (!allMatched && !missingRows.has(refOp)) {
            missingRows.set(refOp, refRow);
        }
    }

    // Pad all arrays to the same length
    const maxLen = Math.max(...aligned.map((arr) => arr.length));

    for (const arr of aligned) {
        while (arr.length < maxLen) {
            // Use the largest array as a template for id/op_code/raw_op_code
            const largestArr = aligned.reduce((a, b) => (a.length > b.length ? a : b));
            const targetRow = largestArr[arr.length];
            const id = targetRow?.id ?? null;
            const opCode = targetRow?.op_code ?? '';
            const rawOpCode = targetRow?.raw_op_code ?? '';
            const opCodeMessage = getMissingOpPrefix(opCode);
            const rawOpCodeMessage = getMissingOpPrefix(rawOpCode);

            arr.push({
                ...PLACEHOLDER,
                id,
                op_code: opCodeMessage,
                raw_op_code: rawOpCodeMessage,
            });
        }
    }

    // Discard datasets with too many missing rows
    for (let dataIndex = 0; dataIndex < dataToAlign.length; dataIndex++) {
        const ratio = maxLen === 0 ? 0 : missingCounts[dataIndex] / maxLen;

        if (ratio > maxMissingRatio) {
            aligned[dataIndex + 1] = [];
        }
    }

    return {
        data: aligned,
        missingRows: Array.from(missingRows.values()),
    };
}

const getMissingOpPrefix = (opCode: string): string => `${MISSING_OP_STRING} - ${opCode}`;

export default alignByOpCode;
