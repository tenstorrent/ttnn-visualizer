// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Operation } from '../model/APIData';

export type OperationStackTraceFields = Pick<
    Operation,
    'id' | 'name' | 'stack_trace' | 'stack_trace_source_file_id' | 'operationFileIdentifier'
>;

export function getOperationStackTraceFields(
    operations: Operation[],
    operationId: number,
): OperationStackTraceFields | null {
    const operation = operations.find((entry) => entry.id === operationId);

    if (!operation) {
        return null;
    }

    return {
        id: operation.id,
        name: operation.name,
        stack_trace: operation.stack_trace,
        stack_trace_source_file_id: operation.stack_trace_source_file_id,
        operationFileIdentifier: operation.operationFileIdentifier,
    };
}
