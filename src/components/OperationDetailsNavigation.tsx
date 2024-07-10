import { useCallback, useEffect } from 'react';
import { Button, ButtonGroup, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useNextOperation, useOperationDetails, usePreviousOperation } from '../hooks/useAPI';
import 'styles/components/OperationDetailsNavigation.scss';
import ROUTES from '../definitions/routes';
import LoadingSpinner from './LoadingSpinner';

interface OperationDetailsNavigationProps {
    operationId: number;
    isFullStackTrace: boolean;
    isLoading: boolean;
}

function OperationDetailsNavigation({ operationId, isFullStackTrace, isLoading }: OperationDetailsNavigationProps) {
    const navigate = useNavigate();
    const { operation } = useOperationDetails(operationId);
    const previousOperation = usePreviousOperation(operationId);
    const nextOperation = useNextOperation(operationId);

    const navigateToPreviousOperation = useCallback(() => {
        navigate(`${ROUTES.OPERATIONS}/${previousOperation?.id}`, { state: { isFullStackTrace } });
    }, [navigate, previousOperation, isFullStackTrace]);

    const navigateToNextOperation = useCallback(() => {
        navigate(`${ROUTES.OPERATIONS}/${nextOperation?.id}`, { state: { isFullStackTrace } });
    }, [navigate, nextOperation, isFullStackTrace]);

    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            const { key } = e;

            if (key === 'ArrowLeft') {
                navigateToPreviousOperation();
            }

            if (key === 'ArrowRight') {
                navigateToNextOperation();
            }
        };

        window.document.addEventListener('keyup', handleKeyPress);

        return () => {
            window.document.removeEventListener('keyup', handleKeyPress);
        };
    }, [navigateToPreviousOperation, navigateToNextOperation]);

    return (
        <nav className='operation-details-navigation'>
            <ButtonGroup className='button-group'>
                <Tooltip
                    content={previousOperation ? `${previousOperation?.id} ${previousOperation?.name}` : ''}
                    placement={PopoverPosition.TOP}
                    disabled={!previousOperation}
                >
                    <Button
                        icon={IconNames.ArrowLeft}
                        disabled={!previousOperation}
                        onClick={navigateToPreviousOperation}
                        outlined
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
                        outlined
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
                        onClick={navigateToNextOperation}
                        outlined
                    />
                </Tooltip>
                <h2 className='title'>{operation && `${operation?.id} ${operation.name}`}</h2>
            </ButtonGroup>

            {isLoading && (
                <div className='operation-details-loader'>
                    <LoadingSpinner />
                </div>
            )}
        </nav>
    );
}

export default OperationDetailsNavigation;
