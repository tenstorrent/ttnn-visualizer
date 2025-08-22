// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect } from 'react';
import { Button, ButtonGroup, ButtonVariant, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useNextOperation, useOperationDetails, usePreviousOperation } from '../hooks/useAPI';
import 'styles/components/OperationDetailsNavigation.scss';
import ROUTES from '../definitions/Routes';
import LoadingSpinner from './LoadingSpinner';
import { LoadingSpinnerSizes } from '../definitions/LoadingSpinner';

interface OperationDetailsNavigationProps {
    operationId: number;
    isLoading: boolean;
}

function OperationDetailsNavigation({ operationId, isLoading }: OperationDetailsNavigationProps) {
    const navigate = useNavigate();
    const { operation } = useOperationDetails(operationId);
    const previousOperation = usePreviousOperation(operationId);
    const nextOperation = useNextOperation(operationId);

    const navigateToPreviousOperation = useCallback(() => {
        navigate(`${ROUTES.OPERATIONS}/${previousOperation?.id}`);
    }, [navigate, previousOperation]);

    const navigateToNextOperation = useCallback(() => {
        navigate(`${ROUTES.OPERATIONS}/${nextOperation?.id}`);
    }, [navigate, nextOperation]);

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
        <nav className='operation-details-navigation navbar'>
            <ButtonGroup className='button-group'>
                <Button
                    icon={IconNames.Graph}
                    onClick={() => navigate(`${ROUTES.GRAPHTREE}/${operationId}`)}
                    variant={ButtonVariant.OUTLINED}
                    className='graph-button'
                    text='View in graph'
                />

                <Tooltip
                    content={previousOperation ? `${previousOperation?.id} ${previousOperation?.name}` : ''}
                    placement={PopoverPosition.TOP}
                    disabled={!previousOperation}
                >
                    <Button
                        icon={IconNames.ArrowLeft}
                        disabled={!previousOperation}
                        onClick={navigateToPreviousOperation}
                        variant={ButtonVariant.OUTLINED}
                        aria-label={
                            previousOperation
                                ? `${previousOperation?.id} ${previousOperation?.name}`
                                : 'No previous operation'
                        }
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
                                },
                            })
                        }
                        variant={ButtonVariant.OUTLINED}
                        aria-label='View operations list'
                    />
                </Tooltip>

                <Tooltip
                    content={nextOperation ? `${nextOperation?.id} ${nextOperation?.name}` : ''}
                    placement={PopoverPosition.TOP}
                    disabled={!nextOperation}
                >
                    <Button
                        endIcon={IconNames.ArrowRight}
                        disabled={!nextOperation}
                        onClick={navigateToNextOperation}
                        variant={ButtonVariant.OUTLINED}
                        aria-label={nextOperation ? `${nextOperation?.id} ${nextOperation?.name}` : 'No next operation'}
                    />
                </Tooltip>

                {isLoading ? (
                    <LoadingSpinner size={LoadingSpinnerSizes.SMALL} />
                ) : (
                    <h2 className='title'>
                        {operation && `${operation.id} ${operation.name}`}{' '}
                        {operation?.operationFileIdentifier && (
                            <span className='small'>{`(${operation.operationFileIdentifier})`}</span>
                        )}
                    </h2>
                )}
            </ButtonGroup>
        </nav>
    );
}

export default OperationDetailsNavigation;
