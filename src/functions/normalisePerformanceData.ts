// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OpType } from '../definitions/Performance';
import { TypedPerfTableRow } from '../definitions/PerfTable';

const MISSING_OP_STRING = 'MISSING';
const PLACEHOLDER: TypedPerfTableRow = {
    id: null,
    global_call_count: null,
    advice: [],
    total_percent: null,
    bound: null,
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
    op_type: OpType.UNKNOWN,
};

export interface NormalisedPerfData {
    data: TypedPerfTableRow[][];
    missingRows: TypedPerfTableRow[];
}

function alignByOpCode(
    refData: TypedPerfTableRow[],
    dataToAlign: TypedPerfTableRow[][],
    threshold = 5,
    maxMissingRatio = 0.3,
): NormalisedPerfData {
    const missingRows = new Map<string, TypedPerfTableRow>();
    const missingCounts = Array(dataToAlign.length).fill(0); // Tracks how many placeholder rows have been inserted for each dataset
    const currentIndexes = Array(dataToAlign.length).fill(0); // Tracks the current index/position in each dataset as the alignment proceeds

    // Return early if there's nothing to align
    if (refData.length === 0 || dataToAlign.length === 0) {
        return { data: [[]], missingRows: [] };
    }

    // aligned[0] will be the refData, aligned[1..n] will be the datasets
    const alignedData: TypedPerfTableRow[][] = [[...refData], ...dataToAlign.map(() => [])];

    // Iterate through each op in the reference data
    for (let refIndex = 0; refIndex < alignedData[0].length; refIndex++) {
        const currentRow = alignedData[0][refIndex];
        const currentOp = currentRow.raw_op_code;
        let allMatched = true;

        // Try to find a matching op in each comparison dataset within the lookahead threshold
        for (let dataIndex = 0; dataIndex < dataToAlign.length; dataIndex++) {
            const dataset = dataToAlign[dataIndex];
            const currentIndex = currentIndexes[dataIndex];
            let matchFound = false;

            // Only look ahead up to the threshold to find a matching op
            for (let lookahead = 0; lookahead <= threshold && currentIndex + lookahead < dataset.length; lookahead++) {
                const candidateOp = dataset[currentIndex + lookahead];

                // If a match is found, add it to the aligned data and update the current index so we don't re-check earlier ops in the next loop
                if (candidateOp.raw_op_code === currentOp) {
                    missingCounts[dataIndex] += lookahead;
                    alignedData[dataIndex + 1].push(candidateOp);
                    currentIndexes[dataIndex] = currentIndex + lookahead + 1;
                    matchFound = true;

                    break;
                }
            }

            // If no match was found within the threshold, insert a placeholder row
            if (!matchFound) {
                missingCounts[dataIndex]++;
                allMatched = false;
                alignedData[dataIndex + 1].push(generatePlaceholder(currentOp, currentOp));
            }
        }

        if (!allMatched && !missingRows.has(currentOp)) {
            missingRows.set(currentOp, currentRow);
        }
    }

    const largestArr = alignedData.reduce((a, b) => (a.length > b.length ? a : b), alignedData[0]);
    const maxLength = largestArr.length;

    // Pad all arrays to the same length if needed
    for (const arr of alignedData) {
        while (arr.length < maxLength) {
            const targetRow = largestArr[arr.length];
            const id = targetRow?.id ?? null;
            const opCode = targetRow?.op_code ?? '';
            const rawOpCode = targetRow?.raw_op_code ?? '';

            arr.push(generatePlaceholder(opCode, rawOpCode, id));
        }
    }

    // Discard datasets with too many missing rows
    for (let dataIndex = 0; dataIndex < dataToAlign.length; dataIndex++) {
        const ratio = missingCounts[dataIndex] / maxLength;

        if (ratio > maxMissingRatio) {
            alignedData[dataIndex + 1] = [];
        }
    }

    return {
        data: alignedData,
        missingRows: Array.from(missingRows.values()),
    };
}

const getMissingOpPrefix = (opCode: string): string => `${MISSING_OP_STRING} - ${opCode}`;

const generatePlaceholder = (opCode: string, rawOpCode: string, id?: number | null): TypedPerfTableRow => {
    return {
        ...PLACEHOLDER,
        id: id ?? null,
        op_code: getMissingOpPrefix(opCode),
        raw_op_code: getMissingOpPrefix(rawOpCode),
    };
};

export default alignByOpCode;
