import { Button, ButtonGroup, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useNextOperation, usePreviousOperation } from '../hooks/useAPI';
import 'styles/components/OperationDetailsNavigation.scss';
import ROUTES from '../definitions/routes';

interface OperationDetailsNavigationProps {
    operationId: string;
}

function OperationDetailsNavigation({ operationId }: OperationDetailsNavigationProps) {
    const navigate = useNavigate();
    const parsedOperationId = parseInt(operationId, 10);
    const previousOperation = usePreviousOperation(parsedOperationId);
    const nextOperation = useNextOperation(parsedOperationId);

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
                        onClick={() => navigate(`${ROUTES.OPERATIONS}`, { state: { operationId } })}
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
                    >
                        Next
                    </Button>
                </Tooltip>
            </ButtonGroup>
        </nav>
    );
}

export default OperationDetailsNavigation;
