// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ButtonGroup, ButtonVariant, Intent, PopoverPosition, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { VirtualItem, useVirtualizer } from '@tanstack/react-virtual';
import { useAtom, useAtomValue } from 'jotai';
import SearchField from './SearchField';
import Collapsible from './Collapsible';
import OperationArguments from './OperationArguments';
import LoadingSpinner from './LoadingSpinner';
import 'styles/components/ListView.scss';
import { useOperationsList } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import {
    activePerformanceReportAtom,
    expandedOperationsAtom,
    operationListScrollAtom,
    selectedOperationRangeAtom,
    shouldCollapseAllOperationsAtom,
} from '../store/app';
import { OperationDescription } from '../model/APIData';
import ListItem from './ListItem';
import { formatSize } from '../functions/math';
import OperationListPerfData from './OperationListPerfData';

const PLACEHOLDER_ARRAY_SIZE = 10;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Height in px of 'scroll-shade' pseudo elements
const TIMEOUT_TIME = 0;

enum SortingOptions {
    OFF,
    ASCENDING,
    DESCENDING,
}

const OperationList = () => {
    const [shouldCollapseAll, setShouldCollapseAll] = useAtom(shouldCollapseAllOperationsAtom);
    const [expandedOperations, setExpandedOperations] = useAtom(expandedOperationsAtom);
    const [operationListScroll, setOperationListScroll] = useAtom(operationListScrollAtom);
    // TODO: Look more at this initialMeasurementsCache
    const [initialMeasurementsCache, setInitialMeasurementsCache] = useState<VirtualItem[]>([]);
    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const [filterQuery, setFilterQuery] = useState('');
    const [filteredOperationsList, setFilteredOperationsList] = useState<OperationDescription[]>([]);
    const [shouldSortByID, setShouldSortByID] = useState<SortingOptions>(SortingOptions.ASCENDING);
    const [shouldSortDuration, setShouldSortDuration] = useState<SortingOptions>(SortingOptions.OFF);
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [focussedRow, setFocussedRow] = useState<number | null>(null);

    const location = useLocation();
    const navigate = useNavigate();
    const { data: fetchedOperations, error, isLoading } = useOperationsList();
    const scrollElementRef = useRef<HTMLDivElement>(null);

    const virtualizer = useVirtualizer({
        count: filteredOperationsList?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
        initialMeasurementsCache,
    });
    const virtualItems = virtualizer.getVirtualItems();
    const numberOfOperations = filteredOperationsList?.length || PLACEHOLDER_ARRAY_SIZE;
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;

    const handleToggleCollapsible = (operationId: number) => {
        setExpandedOperations((currentIds) => {
            const operationIds = [...currentIds];

            if (operationIds.includes(operationId)) {
                return operationIds.filter((id) => id !== operationId);
            }

            operationIds.push(operationId);
            return operationIds;
        });
    };

    const handleSortByID = () => {
        setShouldSortDuration(SortingOptions.OFF);
        setShouldSortByID(
            shouldSortByID === SortingOptions.ASCENDING ? SortingOptions.DESCENDING : SortingOptions.ASCENDING,
        );
    };

    const handleSortByDuration = () => {
        setShouldSortByID(SortingOptions.OFF);
        setShouldSortDuration(
            shouldSortDuration === SortingOptions.ASCENDING ? SortingOptions.DESCENDING : SortingOptions.ASCENDING,
        );
    };

    const handleExpandAllToggle = () => {
        setShouldCollapseAll((shouldCollapse) => !shouldCollapse);
        setExpandedOperations(
            !shouldCollapseAll && filteredOperationsList ? filteredOperationsList.map((operation) => operation.id) : [],
        );
    };

    const handleUserScrolling = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;
        const firstVirtualIndex = Math.max(virtualizer.getVirtualIndexes()[0], 0);

        setOperationListScroll(firstVirtualIndex);

        setHasScrolledFromTop(!(el.scrollTop < OPERATION_EL_HEIGHT / 2));
        setHasScrolledToBottom(el.scrollTop + el.offsetHeight >= el.scrollHeight);
    };

    const operationsWithRange = useMemo(() => {
        if (fetchedOperations && selectedOperationRange) {
            return fetchedOperations.filter(
                (op) => op.id >= selectedOperationRange[0] && op.id <= selectedOperationRange[1],
            );
        }

        return fetchedOperations;
    }, [fetchedOperations, selectedOperationRange]);

    useEffect(() => {
        // console.log(
        //     'update initial cache',
        //     virtualizer.measurementsCache,
        //     'total size:',
        //     virtualizer.measurementsCache.reduce((sum, item) => sum + (item?.size ?? 0), 0),
        // );
        setInitialMeasurementsCache(virtualizer.measurementsCache);
    }, [virtualizer.measurementsCache]);

    useMemo(() => {
        if (operationsWithRange) {
            let operations = [...operationsWithRange];

            if (filterQuery) {
                operations = operationsWithRange?.filter((operation) =>
                    getOperationFilterName(operation).toLowerCase().includes(filterQuery.toLowerCase()),
                );
            }

            if (isSortingModeActive(shouldSortByID)) {
                operations = operations.sort((a, b) => a.id - b.id);

                if (shouldSortByID === SortingOptions.DESCENDING) {
                    operations = operations.reverse();
                }
            } else if (isSortingModeActive(shouldSortDuration)) {
                operations = operations.sort((a, b) => a.duration - b.duration);

                if (shouldSortDuration === SortingOptions.DESCENDING) {
                    operations = operations.reverse();
                }
            }

            operations = selectedOperationRange
                ? operations.filter((op) => op.id >= selectedOperationRange[0] && op.id <= selectedOperationRange[1])
                : operations;

            setFilteredOperationsList(operations);
        }
    }, [operationsWithRange, filterQuery, shouldSortByID, shouldSortDuration, selectedOperationRange]);

    useEffect(() => {
        if (virtualHeight <= 0 && scrollElementRef.current) {
            scrollElementRef.current.scrollTop = 0;
            setHasScrolledFromTop(false);
        }
    }, [virtualHeight]);

    useEffect(() => {
        const initialOperationId = location.state?.previousOperationId;

        if (initialOperationId && virtualizer) {
            const operationIndex =
                fetchedOperations?.findIndex(
                    (operation: OperationDescription) => operation.id === parseInt(initialOperationId, 10),
                ) || 0;

            // Looks better to scroll to the previous index
            const indexToScrollTo = Math.min(Math.max(operationIndex - 1, 0), numberOfOperations);

            // scrollToIndex is not instant, so we have to wait for the virtualHeight to be recalculated
            setTimeout(() => {
                scrollToIndex(indexToScrollTo);
                setOperationListScroll(operationIndex);
                setFocussedRow(operationIndex);
            }, TIMEOUT_TIME);

            // Navigating to the same page replaces the entry in the browser history
            navigate(ROUTES.OPERATIONS, { replace: true });

            setOperationListScroll(operationIndex);
        } else if (operationListScroll !== null) {
            // Scrolling to the next item looks better, and if we do that we have to focus on the index after that one
            const indexToScrollTo =
                operationListScroll === 0 ? 0 : Math.min(Math.max(operationListScroll + 1, 0), numberOfOperations);
            const indexToFocus = indexToScrollTo > 0 ? indexToScrollTo + 1 : indexToScrollTo;

            // scrollToIndex is not instant, so we have to wait for the virtualHeight to be recalculated
            setTimeout(() => {
                scrollToIndex(indexToScrollTo);
                setFocussedRow(indexToFocus);
            }, TIMEOUT_TIME);
        }

        // Bind event listener after scrollToIndex runs
        const scrollElement = scrollElementRef.current;
        const scrollHandler = (event: Event) => handleUserScrolling(event as unknown as UIEvent<HTMLDivElement>);
        scrollElement?.addEventListener('scroll', scrollHandler);

        return () => {
            scrollElement?.removeEventListener('scroll', scrollHandler);
        };

        // eslint-disable-next-line react-hooks/exhaustive-deps -- Only want to run this on mount
    }, []);

    const scrollToIndex = useCallback(
        (index: number) => {
            // console.log(
            //     'scrollToIndex',
            //     virtualizer.measurementsCache,
            //     'total size:',
            //     virtualizer.measurementsCache.reduce((sum, item) => sum + (item?.size ?? 0), 0),
            // );
            virtualizer.scrollToIndex(index, { align: 'start' });
        },
        [virtualizer],
    );

    const scrollToTop = () => {
        setOperationListScroll(null);
        setFocussedRow(null);
        scrollToIndex(0);
    };

    const scrollToEnd = () => {
        scrollToIndex(numberOfOperations);
    };

    return (
        // TODO: Turn this into a generation ListView component used by OperationList and TensorList
        <fieldset className='list-wrap'>
            <legend>Operations</legend>

            <div className='list-controls'>
                <SearchField
                    placeholder='Filter operations'
                    searchQuery={filterQuery}
                    onQueryChanged={(value) => setFilterQuery(value)}
                />

                <ButtonGroup variant='minimal'>
                    <Tooltip
                        content={shouldCollapseAll ? 'Collapse all' : 'Expand all'}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleExpandAllToggle()}
                            endIcon={shouldCollapseAll ? IconNames.CollapseAll : IconNames.ExpandAll}
                            aria-label={shouldCollapseAll ? 'Collapse all' : 'Expand all'}
                        />
                    </Tooltip>

                    <Tooltip
                        content={
                            shouldSortByID === SortingOptions.DESCENDING
                                ? 'Sort by id descending'
                                : 'Sort by id ascending'
                        }
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleSortByID()}
                            icon={
                                shouldSortByID === SortingOptions.DESCENDING
                                    ? IconNames.SortAlphabeticalDesc
                                    : IconNames.SortAlphabetical
                            }
                            variant={isSortingModeActive(shouldSortByID) ? 'outlined' : undefined}
                            aria-label={
                                shouldSortByID === SortingOptions.DESCENDING
                                    ? 'Sort by id descending'
                                    : 'Sort by id ascending'
                            }
                        />
                    </Tooltip>

                    <Tooltip
                        content={
                            shouldSortDuration === SortingOptions.DESCENDING
                                ? 'Sort by duration descending'
                                : 'Sort by duration ascending'
                        }
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleSortByDuration()}
                            icon={
                                shouldSortDuration === SortingOptions.DESCENDING
                                    ? IconNames.SortNumericalDesc
                                    : IconNames.SortNumerical
                            }
                            variant={isSortingModeActive(shouldSortDuration) ? 'outlined' : undefined}
                            aria-label={
                                shouldSortDuration === SortingOptions.DESCENDING
                                    ? 'Sort by duration descending'
                                    : 'Sort by duration ascending'
                            }
                        />
                    </Tooltip>

                    <Tooltip
                        content='Scroll to top'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={scrollToTop}
                            icon={IconNames.DOUBLE_CHEVRON_UP}
                            aria-label='Scroll to top'
                        />
                    </Tooltip>

                    <Tooltip
                        content='Scroll to bottom'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={scrollToEnd}
                            icon={IconNames.DOUBLE_CHEVRON_DOWN}
                            aria-label='Scroll to bottom'
                        />
                    </Tooltip>
                </ButtonGroup>

                {!isLoading && (
                    <p className='result-count'>
                        {operationsWithRange && filterQuery
                            ? `Showing ${numberOfOperations} of ${operationsWithRange.length} operations`
                            : `Showing ${numberOfOperations} operations`}
                    </p>
                )}
            </div>

            <div
                ref={scrollElementRef}
                className={classNames('scrollable-element', {
                    'scroll-shade-top': hasScrolledFromTop && virtualHeight >= 0,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfOperations > virtualItems.length,
                    'scroll-lock': virtualHeight <= 0,
                })}
            >
                <div
                    style={{
                        // Div is sized to the maximum required to render all list items minus our shade element heights
                        height: virtualHeight,
                    }}
                >
                    <ul
                        className='list-container'
                        style={{
                            // Tracks scroll position
                            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                        }}
                    >
                        {filteredOperationsList?.length ? (
                            virtualItems.map((virtualRow) => {
                                const operation = filteredOperationsList[virtualRow.index];

                                return (
                                    <li
                                        className={classNames('list-item-container', {
                                            'focus-fade': focussedRow === virtualRow.index,
                                        })}
                                        data-id={operation.id}
                                        key={virtualRow.key}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                    >
                                        <Collapsible
                                            onExpandToggle={() => handleToggleCollapsible(operation.id)}
                                            label={
                                                <Tooltip
                                                    content={operation?.error ? `Error detected in this operation` : ''}
                                                    placement={PopoverPosition.TOP}
                                                >
                                                    <ListItem
                                                        filterName={getOperationFilterName(operation)}
                                                        filterQuery={filterQuery}
                                                        icon={operation?.error ? IconNames.ERROR : IconNames.CUBE}
                                                        iconColour={operation?.error ? 'error' : 'operation'}
                                                    />
                                                </Tooltip>
                                            }
                                            keepChildrenMounted
                                            additionalElements={
                                                <Button
                                                    className='buffer-view'
                                                    onClick={() => navigate(`${ROUTES.OPERATIONS}/${operation.id}`)}
                                                    text='Memory details'
                                                    intent={Intent.PRIMARY}
                                                    endIcon={IconNames.SEGMENTED_CONTROL}
                                                    size={Size.SMALL}
                                                    variant={ButtonVariant.OUTLINED}
                                                />
                                            }
                                            isOpen={expandedOperations.includes(operation.id)}
                                        >
                                            <div className='arguments-wrapper'>
                                                <p className='monospace'>
                                                    Python execution time: {formatSize(operation.duration)} s
                                                </p>

                                                {operation?.error && (
                                                    <div className='memory-error'>
                                                        <p className='memory-error-title'>
                                                            {operation?.error.error_type}
                                                        </p>
                                                        <p>{operation?.error.error_message}</p>

                                                        <div className='code-wrapper'>
                                                            <code
                                                                className='language-python code-output'
                                                                // eslint-disable-next-line react/no-danger
                                                                dangerouslySetInnerHTML={{
                                                                    __html: operation?.error.error_message,
                                                                }}
                                                            />
                                                        </div>

                                                        <p className='memory-error-title'>Stack Trace</p>

                                                        <div className='code-wrapper'>
                                                            <code
                                                                className='language-python code-output'
                                                                // eslint-disable-next-line react/no-danger
                                                                dangerouslySetInnerHTML={{
                                                                    __html: operation?.error.stack_trace,
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                )}

                                                {activePerformanceReport && (
                                                    <OperationListPerfData operation={operation} />
                                                )}

                                                {operation.arguments && (
                                                    <OperationArguments
                                                        operation={operation}
                                                        operationIndex={virtualRow.index}
                                                        onCollapseTensor={virtualizer.scrollToIndex}
                                                    />
                                                )}
                                            </div>
                                        </Collapsible>
                                    </li>
                                );
                            })
                        ) : (
                            <>
                                {isLoading ? <LoadingSpinner /> : <p>No results</p>}
                                {error && <div>An error occurred: {error.message}</div>}
                            </>
                        )}
                    </ul>
                </div>
            </div>
        </fieldset>
    );
};

function getOperationFilterName(operation: OperationDescription) {
    return `${operation.id} ${operation.name} (${operation.operationFileIdentifier}) `;
}

function isSortingModeActive(sorting: SortingOptions) {
    return sorting === SortingOptions.ASCENDING || sorting === SortingOptions.DESCENDING;
}

export default OperationList;
