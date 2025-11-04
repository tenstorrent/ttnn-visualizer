// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ButtonGroup, ButtonVariant, Intent, PopoverPosition, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useAtom, useAtomValue } from 'jotai';
import SearchField from './SearchField';
import Collapsible from './Collapsible';
import OperationArguments from './OperationArguments';
import LoadingSpinner from './LoadingSpinner';
import 'styles/components/ListView.scss';
import { useOperationsList } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import { activePerformanceReportAtom, selectedOperationRangeAtom, shouldCollapseAllOperationsAtom } from '../store/app';
import { OperationDescription } from '../model/APIData';
import ListItem from './ListItem';
import { formatSize } from '../functions/math';
import OperationListPerfData from './OperationListPerfData';
import StackTrace from './operation-details/StackTrace';
import useRestoreScrollPositionV2 from '../hooks/useRestoreScrollPositionV2';
import { SCROLL_TOLERANCE_PX } from '../definitions/ScrollPositions';
import { ScrollLocationsV2 } from '../definitions/ScrollPositionsV2';

const PLACEHOLDER_ARRAY_SIZE = 50;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Height in px of 'scroll-shade' pseudo elements

enum SortingOptions {
    OFF,
    ASCENDING,
    DESCENDING,
}

const OperationList = () => {
    const [shouldCollapseAll, setShouldCollapseAll] = useAtom(shouldCollapseAllOperationsAtom);

    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    const [filterQuery, setFilterQuery] = useState('');
    const [filteredOperationsList, setFilteredOperationsList] = useState<OperationDescription[]>([]);
    const [shouldSortByID, setShouldSortByID] = useState<SortingOptions>(SortingOptions.ASCENDING);
    const [shouldSortDuration, setShouldSortDuration] = useState<SortingOptions>(SortingOptions.OFF);
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [focusedRow, setFocusedRow] = useState<number | null>(null);

    const location = useLocation();
    const navigate = useNavigate();
    const { data: fetchedOperations, error, isLoading } = useOperationsList();
    const { getListState, updateListState } = useRestoreScrollPositionV2(ScrollLocationsV2.OPERATION_LIST);
    const scrollElementRef = useRef<HTMLDivElement>(null);
    const listStateRef = useRef<number>();

    const listState = getListState();

    const {
        itemCount: restoredItemCount,
        scrollOffset: restoredOffset,
        measurementsCache: restoreMeasurementsCache,
    } = listState ?? {};

    const virtualizer = useVirtualizer({
        estimateSize: () => OPERATION_EL_HEIGHT,
        getScrollElement: () => scrollElementRef.current,
        overscan: 10,
        initialMeasurementsCache: restoreMeasurementsCache,
        count: restoredItemCount || filteredOperationsList?.length || PLACEHOLDER_ARRAY_SIZE,
        initialOffset: restoredOffset || 0,
        // TODO: Can help prevent stuttering when scrolling back up but needs more research
        // measureElement: (element, _entry, instance) => {
        //     const direction = instance.scrollDirection;
        //     if (direction === 'forward' || direction === null) {
        //         // Allow remeasuring when scrolling down or direction is null
        //         return element.getBoundingClientRect().height;
        //     }
        //     // When scrolling up, use cached measurement to prevent stuttering
        //     const indexKey = Number(element.getAttribute('data-index'));
        //     const cachedMeasurement = instance.measurementsCache[indexKey]?.size;
        //     return cachedMeasurement || element.getBoundingClientRect().height;
        // },
    });

    const virtualItems = virtualizer.getVirtualItems();
    const numberOfOperations = filteredOperationsList.length;
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;

    const handleToggleCollapsible = (operationId: number) => {
        let expandedItems: Set<number>;

        if (listState && listState.expandedItems) {
            expandedItems = new Set<number>(listState.expandedItems);
        } else {
            expandedItems = new Set<number>();
        }

        if (expandedItems.has(operationId)) {
            expandedItems.delete(operationId);
        } else {
            expandedItems.add(operationId);
        }

        updateListState({
            expandedItems,
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
        updateListState({
            expandedItems: new Set(
                !shouldCollapseAll && filteredOperationsList
                    ? filteredOperationsList.map((operation) => operation.id)
                    : [],
            ),
        });
    };

    const handleUserScrolling = () => {
        // TODO: Maybe move this into a hook
        updateScrollShade();
    };

    const updateScrollShade = () => {
        if (scrollElementRef.current) {
            const { scrollTop, offsetHeight, scrollHeight } = scrollElementRef.current;

            setHasScrolledFromTop(scrollTop > 0 + SCROLL_TOLERANCE_PX);

            const scrollBottom = scrollTop + offsetHeight;

            setHasScrolledToBottom(scrollBottom >= scrollHeight - SCROLL_TOLERANCE_PX);
        }
    };

    const operationsWithRange = useMemo(() => {
        if (fetchedOperations && selectedOperationRange) {
            return fetchedOperations.filter(
                (op) => op.id >= selectedOperationRange[0] && op.id <= selectedOperationRange[1],
            );
        }

        return fetchedOperations;
    }, [fetchedOperations, selectedOperationRange]);

    const handleToggleStackTrace = (index: number) => {
        const scrollToIndex = index - 1;
        virtualizer.scrollToIndex(scrollToIndex < 0 ? 0 : scrollToIndex);
    };

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

    const scrollToIndex = useCallback(
        (index: number) => virtualizer.scrollToIndex(index, { align: 'start' }),
        [virtualizer],
    );

    const scrollToTop = () => {
        setFocusedRow(null);
        scrollToIndex(0);
        updateListState({
            scrollOffset: 0,
        });
    };

    const scrollToEnd = () => {
        setFocusedRow(null);
        scrollToIndex(numberOfOperations);
        updateListState({
            scrollOffset: scrollElementRef.current?.scrollTop || virtualizer.scrollOffset || 0,
        });
    };

    // Throttled update of list state on scroll change
    const throttledUpdateListState = useCallback(() => {
        if (listStateRef.current) {
            cancelAnimationFrame(listStateRef.current);
        }

        listStateRef.current = requestAnimationFrame(() => {
            updateListState({
                scrollOffset: virtualizer.scrollOffset || 0,
                measurementsCache: virtualizer.measurementsCache,
            });
        });
    }, [updateListState, virtualizer.scrollOffset, virtualizer.measurementsCache]);

    // Reset scroll to top
    useEffect(() => {
        if (virtualHeight <= 0 && scrollElementRef.current) {
            scrollElementRef.current.scrollTop = 0;
            setHasScrolledFromTop(false);
            setHasScrolledToBottom(false);
        }

        updateScrollShade();
    }, [virtualHeight]);

    useEffect(() => {
        const initialOperationId = location.state?.previousOperationId;

        if (initialOperationId) {
            const operationIndex =
                fetchedOperations?.findIndex(
                    (operation: OperationDescription) => operation.id === parseInt(initialOperationId, 10),
                ) || 0;

            setFocusedRow(operationIndex);

            // Navigating to the same page replaces the entry in the browser history
            navigate(ROUTES.OPERATIONS, { replace: true });
        }
    }, [fetchedOperations, location.state?.previousOperationId, navigate]);

    // List state update
    useEffect(() => {
        throttledUpdateListState();

        return () => {
            if (listStateRef.current) {
                cancelAnimationFrame(listStateRef.current);
            }
        };
    }, [throttledUpdateListState]);

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

                <ButtonGroup variant={ButtonVariant.MINIMAL}>
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
                            variant={isSortingModeActive(shouldSortByID) ? ButtonVariant.OUTLINED : undefined}
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
                            variant={isSortingModeActive(shouldSortDuration) ? ButtonVariant.OUTLINED : undefined}
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
                })}
                onScroll={handleUserScrolling}
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
                                            'focus-fade': focusedRow === virtualRow.index,
                                        })}
                                        key={virtualRow.key}
                                        ref={virtualizer.measureElement}
                                        data-id={operation.id}
                                        data-index={virtualRow.index}
                                    >
                                        <Collapsible
                                            onExpandToggle={() => handleToggleCollapsible(operation.id)}
                                            label={
                                                <Tooltip
                                                    content={operation?.error ? `Error recorded in operation` : ''}
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
                                            isOpen={!!listState?.expandedItems?.has(operation.id)}
                                        >
                                            <div className='arguments-wrapper'>
                                                <p className='monospace'>
                                                    Python execution time: {formatSize(operation.duration)} s
                                                </p>

                                                {operation?.error && (
                                                    <>
                                                        <div className='memory-error'>
                                                            <p className='memory-error-title'>
                                                                {operation.error.error_type}
                                                            </p>

                                                            <StackTrace
                                                                stackTrace={operation.error.error_message}
                                                                language='cpp'
                                                                hideSourceButton
                                                                isInline
                                                                onExpandChange={(_isOpen: boolean) =>
                                                                    handleToggleStackTrace(virtualRow.index)
                                                                }
                                                            />
                                                        </div>

                                                        <div className='memory-error'>
                                                            <p className='memory-error-title'>Stack Trace</p>

                                                            <StackTrace
                                                                stackTrace={operation.error.stack_trace}
                                                                language='cpp'
                                                                hideSourceButton
                                                                isInline
                                                                onExpandChange={(_isOpen: boolean) =>
                                                                    handleToggleStackTrace(virtualRow.index)
                                                                }
                                                            />
                                                        </div>
                                                    </>
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
                                {isLoading ? <LoadingSpinner /> : <p className='no-results'>No results</p>}
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
