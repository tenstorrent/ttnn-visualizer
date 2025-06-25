// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OperationDescription, Tensor } from '../model/APIData';

function getDeallocationOperation(
    tensor: Tensor,
    operations: OperationDescription[],
): OperationDescription | undefined {
    // TODO: Maybe we can strengthen this logic to ensure we're looking at deallocations rather than just checking the name
    const matchingInputs = operations.filter(
        (operation) =>
            operation.name.includes('deallocate') && operation.inputs.find((input) => input.id === tensor.id),
    );

    return matchingInputs?.[0];
}

export default getDeallocationOperation;
