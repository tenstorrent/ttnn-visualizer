import { OperationDescription } from '../model/APIData';
import { Tensor } from '../model/Graph';

function getNextAllocationOperation(tensor: Tensor, operations: OperationDescription[]): number | undefined {
    const startingId = tensor.consumers[tensor.consumers.length - 1];
    const matchingOperations = operations.filter(
        (operation) =>
            operation.id > startingId && operation.outputs.some((output) => output.address === tensor.address),
    );

    return matchingOperations.map((operation) => operation.id)[0];
}

export default getNextAllocationOperation;
