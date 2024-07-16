import { useCallback, useEffect, useMemo } from 'react';
import { Button, ButtonGroup, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useLocation, useNavigate } from 'react-router';
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
    const location = useLocation();
    const { operation } = useOperationDetails(operationId);
    const previousOperation = usePreviousOperation(operationId);
    const nextOperation = useNextOperation(operationId);

    const expandedOperations = useMemo(
        () => location.state?.expandedOperations || [],
        [location.state?.expandedOperations],
    );

    const navigateToPreviousOperation = useCallback(() => {
        navigate(`${ROUTES.OPERATIONS}/${previousOperation?.id}`, { state: { isFullStackTrace, expandedOperations } });
    }, [navigate, previousOperation, isFullStackTrace, expandedOperations]);

    const navigateToNextOperation = useCallback(() => {
        navigate(`${ROUTES.OPERATIONS}/${nextOperation?.id}`, { state: { isFullStackTrace, expandedOperations } });
    }, [navigate, nextOperation, isFullStackTrace, expandedOperations]);

    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            const { key } = e;

            if (key === 'ArrowLeft' && previousOperation) {
                navigateToPreviousOperation();
            }

            if (key === 'ArrowRight' && nextOperation) {
                navigateToNextOperation();
            }
        };

        window.document.addEventListener('keyup', handleKeyPress);

        return () => {
            window.document.removeEventListener('keyup', handleKeyPress);
        };
    }, [navigateToPreviousOperation, navigateToNextOperation, previousOperation, nextOperation]);

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
                            navigate(`${ROUTES.OPERATIONS}`, {
                                state: {
                                    previousOperationId: operationId,
                                    expandedOperations,
                                },
                            })
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
