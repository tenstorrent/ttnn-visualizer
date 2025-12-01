// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect, useState } from 'react';
import {
    Button,
    ButtonGroup,
    ButtonVariant,
    Intent,
    PopoverPosition,
    Size,
    Tab,
    TabId,
    Tabs,
    Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useNavigate } from 'react-router';
import { useNextOperation, useOperationDetails, usePreviousOperation } from '../hooks/useAPI';
import 'styles/components/OperationDetailsNavigation.scss';
import ROUTES from '../definitions/Routes';
import LoadingSpinner from './LoadingSpinner';
import { LoadingSpinnerSizes } from '../definitions/LoadingSpinner';
import Overlay from './Overlay';
import StackTrace from './operation-details/StackTrace';
import { StackTraceLanguage } from '../definitions/StackTrace';

enum TAB_IDS {
    ERROR = 'ERROR',
    STACK_TRACE = 'STACK_TRACE',
}

interface OperationDetailsNavigationProps {
    operationId: number;
    isLoading: boolean;
}

function OperationDetailsNavigation({ operationId, isLoading }: OperationDetailsNavigationProps) {
    const [errorIsOpen, setErrorIsOpen] = useState(false);
    const [selectedTabId, setSelectedTabId] = useState<TabId>(TAB_IDS.ERROR);
    const [isErrorExpanded, setisErrorExpanded] = useState(false);

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
                                ? `Go to previous operation ${previousOperation?.id} ${previousOperation?.name}`
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
                        aria-label={
                            nextOperation
                                ? `Go to next operation ${nextOperation?.id} ${nextOperation?.name}`
                                : 'No next operation'
                        }
                    />
                </Tooltip>

                {isLoading ? (
                    <LoadingSpinner size={LoadingSpinnerSizes.SMALL} />
                ) : (
                    <>
                        <h2 className='title'>
                            {operation && `${operation.id} ${operation.name}`}{' '}
                            {operation?.operationFileIdentifier && (
                                <span className='small'>{`(${operation.operationFileIdentifier})`}</span>
                            )}
                        </h2>

                        {operation?.error && (
                            <Button
                                icon={IconNames.ERROR}
                                intent={Intent.DANGER}
                                onClick={() => setErrorIsOpen(true)}
                                variant={ButtonVariant.MINIMAL}
                                text='View operation error'
                            />
                        )}
                    </>
                )}
            </ButtonGroup>

            <Overlay
                isOpen={errorIsOpen}
                onClose={() => setErrorIsOpen(false)}
            >
                {operation?.error && (
                    <Tabs
                        selectedTabId={selectedTabId}
                        onChange={setSelectedTabId}
                        size={Size.LARGE}
                        id='error-details-tabs'
                        className='report-tabs'
                        renderActiveTabPanelOnly
                    >
                        <Tab
                            id={TAB_IDS.ERROR}
                            title='Error details'
                            icon={IconNames.COMMENT}
                            panel={
                                <StackTrace
                                    stackTrace={operation.error.error_message}
                                    language={StackTraceLanguage.CPP}
                                    intent={Intent.DANGER}
                                    isInitiallyExpanded={isErrorExpanded}
                                    onExpandChange={(state) => setisErrorExpanded(!state)}
                                    hideSourceButton
                                    isInline
                                />
                            }
                        />

                        <Tab
                            id={TAB_IDS.STACK_TRACE}
                            title='Stack Trace'
                            icon={IconNames.APPLICATION}
                            panel={
                                <StackTrace
                                    stackTrace={operation.error.stack_trace}
                                    language={StackTraceLanguage.CPP}
                                    intent={Intent.DANGER}
                                    isInitiallyExpanded={isErrorExpanded}
                                    onExpandChange={(state) => setisErrorExpanded(!state)}
                                    hideSourceButton
                                    isInline
                                />
                            }
                        />
                    </Tabs>
                )}
            </Overlay>
        </nav>
    );
}

export default OperationDetailsNavigation;
