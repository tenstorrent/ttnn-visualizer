// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OperationDescription, Tensor } from '../model/APIData';
import { isDeallocate } from '../definitions/Deallocate';

function getDeallocationOperation(
    tensor: Tensor,
    operations: OperationDescription[],
): OperationDescription | undefined {
    return operations.find(
        (operation) => isDeallocate(operation.name) && operation.inputs.find((input) => input.id === tensor.id),
    );
}

export default getDeallocationOperation;
