import 'styles/components/BufferTable.scss';
import { Icon, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { Tensor } from '../model/Graph';
import { OperationDescription } from '../model/APIData';
import { useNextBuffer } from '../hooks/useAPI';
import { toHex } from '../functions/math';

interface BufferTableProps {
    tensor: Tensor;
    operations: OperationDescription[];
    queryKey: string;
}

function BufferTable({ tensor, operations, queryKey }: BufferTableProps) {
    const { address, consumers } = tensor;
    const lastOperation = tensor.consumers[tensor.consumers.length - 1];
    const deallocationOperation = getDeallocation(tensor, operations);
    const { data: buffer, isLoading } = useNextBuffer(address, consumers, queryKey);

    return (
        <table>
            <tbody>
                <tr>
                    <th>Last used</th>
                    <td>
                        Last used by Operation {lastOperation}{' '}
                        {operations.find((operation) => operation.id === lastOperation)?.name}
                    </td>
                </tr>

                <tr>
                    <th>Deallocation</th>
                    <td>
                        {isLoading ? 'Loading...' : undefined}
                        {buffer && !isLoading && deallocationOperation ? (
                            <span className='deallocation-status'>
                                Deallocation found in Operation {deallocationOperation}
                                <Icon
                                    icon={IconNames.TICK}
                                    intent={Intent.SUCCESS}
                                />
                            </span>
                        ) : (
                            <span className='deallocation-status'>
                                Missing deallocation operation
                                <Icon
                                    icon={IconNames.WARNING_SIGN}
                                    intent={Intent.WARNING}
                                />
                            </span>
                        )}
                    </td>
                </tr>

                <tr>
                    <th>Next allocation</th>
                    <td>
                        {isLoading ? 'Loading...' : undefined}
                        {buffer && address && !isLoading ? (
                            <>
                                {toHex(address)} next allocated in Operation {buffer.operation_id} (+
                                {buffer.next_usage} operations)
                            </>
                        ) : (
                            'No subsequent buffer found'
                        )}
                    </td>
                </tr>
            </tbody>
        </table>
    );
}

function getDeallocation(tensor: Tensor, operations: OperationDescription[]) {
    // TODO: Maybe we can strengthen this logic to ensure we're looking at deallocations rather than just checking the name
    const matchingInputs = operations.filter(
        (operation) =>
            operation.name.includes('deallocate') && operation.inputs.find((input) => input.id === tensor.id),
    );

    return matchingInputs.map((x) => x.id).toString() || '';
}

export default BufferTable;
