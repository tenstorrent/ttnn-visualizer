// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OperationDescription, Tensor } from '../model/APIData';

function getNextAllocationOperation(
    tensor: Tensor,
    operations: OperationDescription[],
): OperationDescription | undefined {
    const startingId = tensor.consumers[tensor.consumers.length - 1];
    const matchingOperations = operations.filter(
        (operation) =>
            operation.id > startingId && operation.outputs.some((output) => output.address === tensor.address),
    );

    return matchingOperations?.[0];
}

export default getNextAllocationOperation;
