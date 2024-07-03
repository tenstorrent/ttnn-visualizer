import { Button, ButtonGroup, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useNextOperation, useOperationDetails, usePreviousOperation } from '../hooks/useAPI';
import 'styles/components/OperationDetailsNavigation.scss';
import ROUTES from '../definitions/routes';

interface OperationDetailsNavigationProps {
    operationId: number;
}

function OperationDetailsNavigation({ operationId }: OperationDetailsNavigationProps) {
    const navigate = useNavigate();
    const { operation } = useOperationDetails(operationId);
    const previousOperation = usePreviousOperation(operationId);
    const nextOperation = useNextOperation(operationId);

    return (
        <nav>
            <ButtonGroup className='operation-details-navigation'>
                <Tooltip
                    content={previousOperation ? `${previousOperation?.id} ${previousOperation?.name}` : ''}
                    placement={PopoverPosition.TOP}
                    disabled={!previousOperation}
                >
                    <Button
                        icon={IconNames.ArrowLeft}
                        disabled={!previousOperation}
                        onClick={() => navigate(`${ROUTES.OPERATIONS}/${previousOperation?.id}`)}
                    />
                </Tooltip>

                <Tooltip
                    content='View operations list'
                    placement={PopoverPosition.TOP}
                >
                    <Button
                        icon={IconNames.LIST}
                        onClick={() =>
                            navigate(`${ROUTES.OPERATIONS}`, { state: { previousOperationId: operationId } })
                        }
                    />
                </Tooltip>

                <Tooltip
                    content={nextOperation ? `${nextOperation?.id} ${nextOperation?.name}` : ''}
                    placement={PopoverPosition.TOP}
                    disabled={!nextOperation}
                >
                    <Button
                        rightIcon={IconNames.ArrowRight}
                        disabled={!nextOperation}
                        onClick={() => navigate(`${ROUTES.OPERATIONS}/${nextOperation?.id}`)}
                    />
                </Tooltip>
                <h2 className='title'>{operation && `${operation?.id} ${operation.name}`}</h2>
            </ButtonGroup>
        </nav>
    );
}

export default OperationDetailsNavigation;
