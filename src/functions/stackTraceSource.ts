// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Operation } from '../model/APIData';

const FILE_PATH_REGEX = /File "(.*)"/m;
const LINE_NUMBER_REGEX = /line (\d*),/m;

type OperationStackTraceFields = Pick<Operation, 'stack_trace' | 'stack_trace_source_file_id'>;

export interface OperationSourceData {
    filePath: string;
    lineNumber: number | null;
}

export const getStackTraceFilePath = (stackTrace: string): string => FILE_PATH_REGEX.exec(stackTrace)?.[1] ?? '';

export const getStackTraceLineNumber = (stackTrace: string): number | null => {
    const match = LINE_NUMBER_REGEX.exec(stackTrace);
    return match?.[1] ? parseInt(match[1], 10) : null;
};

export const extractOperationSourceData = (operation: OperationStackTraceFields): OperationSourceData | null => {
    const filePath = getStackTraceFilePath(operation.stack_trace);
    const hasSource = !!filePath || operation.stack_trace_source_file_id != null;

    if (!hasSource) {
        return null;
    }

    return {
        filePath,
        lineNumber: getStackTraceLineNumber(operation.stack_trace),
    };
};
