// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useCallback, useEffect } from 'react';
import { Button, ButtonGroup, PopoverPosition, Tooltip } from '@blueprintjs/core';
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
                <Tooltip
                    content='View operations graph'
                    placement={PopoverPosition.TOP}
                >
                    <Button
                        icon={IconNames.Graph}
                        onClick={() => navigate(`${ROUTES.GRAPHTREE}/${operationId}`)}
                        outlined
                        className='graph-button'
                    />
                </Tooltip>
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
