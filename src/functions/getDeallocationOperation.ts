import { OperationDescription } from '../model/APIData';
import { Tensor } from '../model/Graph';

function getDeallocationOperation(tensor: Tensor, operations: OperationDescription[]): number | undefined {
    // TODO: Maybe we can strengthen this logic to ensure we're looking at deallocations rather than just checking the name
    const matchingInputs = operations.filter(
        (operation) =>
            operation.name.includes('deallocate') && operation.inputs.find((input) => input.id === tensor.id),
    );

    return matchingInputs.map((x) => x.id)[0];
}

export default getDeallocationOperation;
