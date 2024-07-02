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

    const handleNavigate = (path: string | undefined) => {
        if (path) {
            navigate(path);
        }
    };

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
                        onClick={() => handleNavigate(`${ROUTES.OPERATIONS}/${previousOperation?.id}`)}
                    >
                        Previous
                    </Button>
                </Tooltip>

                <Tooltip
                    content='View operations list'
                    placement={PopoverPosition.TOP}
                >
                    <Button
                        icon={IconNames.LIST}
                        onClick={() => handleNavigate(ROUTES.OPERATIONS)}
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
                        onClick={() => handleNavigate(`${ROUTES.OPERATIONS}/${nextOperation?.id}`)}
                    >
                        Next
                    </Button>
                </Tooltip>
                <h2 className='title'>{operation && `${operation?.id} ${operation.name}`}</h2>
            </ButtonGroup>
        </nav>
    );
}

export default OperationDetailsNavigation;
