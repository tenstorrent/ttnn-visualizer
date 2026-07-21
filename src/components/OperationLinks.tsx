// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Link } from 'react-router-dom';
import ROUTES from '../definitions/Routes';
import { Operation, Tensor } from '../model/APIData';

export const getOperationLink = (operationId: number, operations: Operation[]) => {
    const operation = operations.find((entry) => entry.id === operationId);

    if (!operation) {
        return null;
    }

    return (
        <Link to={`${ROUTES.OPERATIONS}/${operation.id}`}>
            {operation.id} {operation.name} ({operation.operationFileIdentifier})
        </Link>
    );
};

/**
 * The trailing consumer of a tensor is often a `deallocate` op, which is not
 * a useful target for the user. When that's the case, prefer the consumer one
 * step earlier in the list so the link points at meaningful work.
 */
export const getLastConsumerLink = (tensor: Tensor, operations: Operation[]) => {
    const lastOperationId = tensor.consumers[tensor.consumers.length - 1];
    let operation = operations.find((entry) => entry.id === lastOperationId);

    if (operation?.name.includes('deallocate') && tensor.consumers.length > 1) {
        operation = operations.find((entry) => entry.id === tensor.consumers[tensor.consumers.length - 2]);
    }

    return operation ? getOperationLink(operation.id, operations) : null;
};
