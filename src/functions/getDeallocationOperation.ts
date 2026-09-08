// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { OperationDescription, Tensor } from '../model/APIData';
import { DEALLOCATE_OP_NAME_LIST } from '../definitions/Deallocate';

function getDeallocationOperation(
    tensor: Tensor,
    operations: OperationDescription[],
): OperationDescription | undefined {
    return operations.find(
        (operation) =>
            DEALLOCATE_OP_NAME_LIST.includes(operation.name.toLowerCase()) &&
            operation.inputs.find((input) => input.id === tensor.id),
    );
}

export default getDeallocationOperation;
