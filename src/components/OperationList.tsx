// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, ButtonGroup, ButtonVariant, Intent, PopoverPosition, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useVirtualizer } from '@tanstack/react-virtual';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import 'styles/components/ListView.scss';
import ROUTES from '../definitions/Routes';
import { ScrollLocations } from '../definitions/VirtualLists';
import { SortingOptions } from '../definitions/SortingOptions';
import { StackTraceLanguage } from '../definitions/StackTrace';
import { formatSize } from '../functions/math';
import { useGetUniqueDeviceOperationsList, useOperationsList } from '../hooks/useAPI';
import useRestoreScrollPosition from '../hooks/useRestoreScrollPosition';
import useScrollShade from '../hooks/useScrollShade';
import { OperationDescription } from '../model/APIData';
import {
    operationListFilterAtom,
    selectedDeviceOperationsAtom,
    selectedOperationRangeAtom,
    shouldCollapseAllOperationsAtom,
    shouldSortByIDAtom,
    shouldSortDurationAtom,
} from '../store/app';
import Collapsible from './Collapsible';
import ListItem from './ListItem';
import LoadingSpinner from './LoadingSpinner';
import StackTrace from './operation-details/StackTrace';
import OperationArguments from './OperationArguments';
import OperationListPerfData from './OperationListPerfData';
import SearchField from './SearchField';
import SimpleMultiselect from './SimpleMultiselect';

const PLACEHOLDER_ARRAY_SIZE = 50;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Total height in px of 'scroll-shade' pseudo elements

const OperationList = () => {
    const [shouldCollapseAll, setShouldCollapseAll] = useAtom(shouldCollapseAllOperationsAtom);
    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);

    const [filterQuery, setFilterQuery] = useAtom(operationListFilterAtom);
    const [shouldSortByID, setShouldSortByID] = useAtom(shouldSortByIDAtom);
    const [shouldSortDuration, setShouldSortDuration] = useAtom(shouldSortDurationAtom);
    const [focusedRow, setFocusedRow] = useState<number | null>(null);
    const [expandedItems, setExpandedItems] = useState<number[]>([]);
    const [selectedDeviceOperations, setSelectedDeviceOperations] = useAtom(selectedDeviceOperationsAtom);

    const location = useLocation();
    const navigate = useNavigate();
    const { data: fetchedOperations, error, isLoading } = useOperationsList();
    const { hasScrolledFromTop, hasScrolledToBottom, updateScrollShade, resetScrollShade, shadeClasses } =
        useScrollShade();
    const { getListState, updateListState } = useRestoreScrollPosition(ScrollLocations.OPERATION_LIST);
    const scrollElementRef = useRef<HTMLDivElement>(null);

    const operationsWithRange = useMemo(() => {
        if (fetchedOperations && selectedOperationRange) {
            return fetchedOperations.filter(
                (op) => op.id >= selectedOperationRange[0] && op.id <= selectedOperationRange[1],
            );
        }

        return fetchedOperations;
    }, [fetchedOperations, selectedOperationRange]);
    const uniqueDeviceOperationNames = useGetUniqueDeviceOperationsList();

    const filterDeviceOperations = (list: string[]) => {
        setSelectedDeviceOperations(new Set(list));
    };

    const filteredOperationsList = useMemo(() => {
        if (operationsWithRange) {
            let operations = [...operationsWithRange];

            if (filterQuery) {
                operations = operationsWithRange?.filter((operation) =>
                    getOperationFilterName(operation).toLowerCase().includes(filterQuery.toLowerCase()),
                );
            }

            if (selectedDeviceOperations.size > 0) {
                operations = operations.filter((operation) =>
                    operation.deviceOperationNameList.some((opName) => selectedDeviceOperations.has(opName)),
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

            return operations;
        }

        return [];
    }, [
        //
        operationsWithRange,
        filterQuery,
        selectedDeviceOperations,
        shouldSortByID,
        shouldSortDuration,
    ]);

    const {
        scrollOffset: restoredOffset,
        measurementsCache: restoredMeasurementsCache,
        expandedItems: restoredExpandedItems,
    } = useMemo(() => getListState(), [getListState]) ?? {};

    const virtualizer = useVirtualizer({
        estimateSize: () => OPERATION_EL_HEIGHT,
        getScrollElement: () => scrollElementRef.current,
        overscan: 10,
        initialMeasurementsCache: restoredMeasurementsCache,
        count: filteredOperationsList?.length || PLACEHOLDER_ARRAY_SIZE,
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
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;
    const numberOfOperations = filteredOperationsList?.length || PLACEHOLDER_ARRAY_SIZE;

    // Store latest values in refs for unmount cleanup
    const scrollOffsetRef = useRef(virtualizer.scrollOffset);
    const measurementsCacheRef = useRef(virtualizer.measurementsCache);
    const expandedItemsRef = useRef(expandedItems);

    const handleToggleCollapsible = useCallback((operationId: number) => {
        setExpandedItems((currentExpanded) => {
            const newList = currentExpanded || [];

            return newList.includes(operationId)
                ? newList.filter((id) => id !== operationId)
                : [...newList, operationId];
        });
    }, []);

    const handleSortByID = useCallback(() => {
        setShouldSortDuration(SortingOptions.OFF);
        setShouldSortByID((current) => {
            if (current === SortingOptions.OFF) {
                return SortingOptions.ASCENDING;
            }

            if (current === SortingOptions.DESCENDING) {
                return SortingOptions.OFF;
            }

            return SortingOptions.DESCENDING;
        });
    }, [setShouldSortByID, setShouldSortDuration]);

    const handleSortByDuration = useCallback(() => {
        setShouldSortByID(SortingOptions.OFF);
        setShouldSortDuration((current) => {
            if (current === SortingOptions.OFF) {
                return SortingOptions.ASCENDING;
            }

            if (current === SortingOptions.DESCENDING) {
                return SortingOptions.OFF;
            }

            return SortingOptions.DESCENDING;
        });
    }, [setShouldSortDuration, setShouldSortByID]);

    const handleExpandAllToggle = useCallback(() => {
        setShouldCollapseAll((shouldCollapse) => !shouldCollapse);

        setExpandedItems(
            !shouldCollapseAll && filteredOperationsList ? filteredOperationsList.map((operation) => operation.id) : [],
        );
    }, [filteredOperationsList, shouldCollapseAll, setShouldCollapseAll]);

    const handleUserScrolling = useCallback(() => {
        if (scrollElementRef.current) {
            updateScrollShade(scrollElementRef.current);
        }
    }, [updateScrollShade]);

    const handleToggleStackTrace = (index: number) => {
        const scrollToIndex = index - 1;
        virtualizer.scrollToIndex(scrollToIndex < 0 ? 0 : scrollToIndex);
    };

    const scrollToIndex = useCallback(
        (index: number) => virtualizer.scrollToIndex(index, { align: 'start' }),
        [virtualizer],
    );

    const scrollToTop = () => {
        setFocusedRow(null);
        scrollToIndex(0);
    };

    const scrollToEnd = () => {
        setFocusedRow(null);
        scrollToIndex(numberOfOperations);
    };

    const sortByIdControl = useMemo(() => {
        let label = 'Clear ID sorting';

        if (shouldSortByID === SortingOptions.OFF) {
            label = 'Sort by ID (ascending)';
        }
        if (shouldSortByID === SortingOptions.ASCENDING) {
            label = 'Sort by ID (descending)';
        }

        const icon =
            shouldSortByID === SortingOptions.ASCENDING || shouldSortByID === SortingOptions.OFF
                ? IconNames.SORT_ALPHABETICAL
                : IconNames.SORT_ALPHABETICAL_DESC;

        return { icon, label };
    }, [shouldSortByID]);

    const sortByDurationControl = useMemo(() => {
        let label = 'Clear Duration sorting';

        if (shouldSortDuration === SortingOptions.OFF) {
            label = 'Sort by Duration (ascending)';
        }
        if (shouldSortDuration === SortingOptions.ASCENDING) {
            label = 'Sort by Duration (descending)';
        }

        const icon =
            shouldSortDuration === SortingOptions.ASCENDING || shouldSortDuration === SortingOptions.OFF
                ? IconNames.SORT_NUMERICAL
                : IconNames.SORT_NUMERICAL_DESC;

        return { icon, label };
    }, [shouldSortDuration]);

    const shouldCollapseAllLabel = shouldCollapseAll ? 'Collapse all' : 'Expand all';
    const scrollToTopLabel = 'Scroll to top';
    const scrollToBottomLabel = 'Scroll to bottom';

    useEffect(() => {
        const initialOperationId = location.state?.previousOperationId;

        if (initialOperationId) {
            const operationIndex =
                filteredOperationsList?.findIndex(
                    (operation: OperationDescription) => operation.id === parseInt(initialOperationId, 10),
                ) || 0;

            setFocusedRow(operationIndex);

            // Navigating to the same page replaces the entry in the browser history
            navigate(ROUTES.OPERATIONS, { replace: true });
        }
    }, [filteredOperationsList, location.state?.previousOperationId, navigate]);

    useEffect(() => {
        if (virtualHeight <= 0 && scrollElementRef.current) {
            scrollElementRef.current.scrollTop = 0;
            resetScrollShade();
        } else if (scrollElementRef.current) {
            updateScrollShade(scrollElementRef.current);
        }
    }, [virtualHeight, updateScrollShade, resetScrollShade]);

    // Restore expanded items on mount
    useEffect(() => {
        setExpandedItems(restoredExpandedItems || []);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep stored refs updated
    useEffect(() => {
        scrollOffsetRef.current = virtualizer.scrollOffset;
    }, [virtualizer.scrollOffset]);
    useEffect(() => {
        measurementsCacheRef.current = virtualizer.measurementsCache;
    }, [virtualizer.measurementsCache]);
    useEffect(() => {
        expandedItemsRef.current = expandedItems;
    }, [expandedItems]);

    // Update stored list state on unmount
    useEffect(() => {
        return () => {
            updateListState({
                scrollOffset: scrollOffsetRef.current || 0,
                measurementsCache: measurementsCacheRef.current,
                expandedItems: expandedItemsRef.current,
            });
        };
    }, [updateListState, filteredOperationsList]);

    return (
        // TODO: Turn this into a generic ListView component used by OperationList and TensorList
        <fieldset className='list-wrap operations-list-component'>
            <legend>Operations</legend>

            <div className='list-controls'>
                <SearchField
                    placeholder='Filter operations'
                    searchQuery={filterQuery}
                    onQueryChanged={(value) => setFilterQuery(value)}
                />

                <SimpleMultiselect
                    label='Device Operations'
                    optionList={uniqueDeviceOperationNames || []}
                    onUpdateHandler={filterDeviceOperations}
                    initialValue={selectedDeviceOperations ? Array.from(selectedDeviceOperations) : []}
                />

                <ButtonGroup variant={ButtonVariant.MINIMAL}>
                    <Tooltip
                        content={shouldCollapseAllLabel}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleExpandAllToggle()}
                            endIcon={shouldCollapseAll ? IconNames.CollapseAll : IconNames.ExpandAll}
                            aria-label={shouldCollapseAllLabel}
                        />
                    </Tooltip>

                    <Tooltip
                        content={sortByIdControl.label}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleSortByID()}
                            icon={sortByIdControl.icon}
                            variant={isSortingModeActive(shouldSortByID) ? ButtonVariant.OUTLINED : undefined}
                            aria-label={sortByIdControl.label}
                        />
                    </Tooltip>

                    <Tooltip
                        content={sortByDurationControl.label}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleSortByDuration()}
                            icon={sortByDurationControl.icon}
                            variant={isSortingModeActive(shouldSortDuration) ? ButtonVariant.OUTLINED : undefined}
                            aria-label={sortByDurationControl.label}
                        />
                    </Tooltip>

                    <Tooltip
                        content={scrollToTopLabel}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={scrollToTop}
                            icon={IconNames.DOUBLE_CHEVRON_UP}
                            aria-label={scrollToTopLabel}
                        />
                    </Tooltip>

                    <Tooltip
                        content={scrollToBottomLabel}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={scrollToEnd}
                            icon={IconNames.DOUBLE_CHEVRON_DOWN}
                            aria-label={scrollToBottomLabel}
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
                    [shadeClasses.top]: hasScrolledFromTop && virtualHeight >= 0,
                    [shadeClasses.bottom]: !hasScrolledToBottom && numberOfOperations > virtualItems.length,
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
                                                    content='Error recorded in operation'
                                                    placement={PopoverPosition.TOP}
                                                    disabled={!operation?.error}
                                                >
                                                    <ListItem
                                                        filterName={getOperationFilterName(operation)}
                                                        filterQuery={filterQuery}
                                                        icon={operation?.error ? IconNames.ERROR : IconNames.CUBE}
                                                        iconColour={operation?.error ? 'error' : 'operation'}
                                                    />
                                                </Tooltip>
                                            }
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
                                            isOpen={!!expandedItems?.includes(operation.id)}
                                            keepChildrenMounted
                                        >
                                            <div className='arguments-wrapper'>
                                                <p className='monospace'>
                                                    Python execution time: {formatSize(operation.duration)} s
                                                </p>

                                                {operation?.error && (
                                                    <>
                                                        <StackTrace
                                                            className='memory-error'
                                                            title='Error Message'
                                                            stackTrace={operation.error.error_message}
                                                            language={StackTraceLanguage.CPP}
                                                            onExpandChange={(_isOpen: boolean) =>
                                                                handleToggleStackTrace(virtualRow.index)
                                                            }
                                                            intent={Intent.DANGER}
                                                            hideSourceButton
                                                            isInline
                                                        />

                                                        <StackTrace
                                                            className='memory-error'
                                                            title='Error Stack Trace'
                                                            stackTrace={operation.error.stack_trace}
                                                            language={StackTraceLanguage.CPP}
                                                            onExpandChange={(_isOpen: boolean) =>
                                                                handleToggleStackTrace(virtualRow.index)
                                                            }
                                                            intent={Intent.DANGER}
                                                            hideSourceButton
                                                            isInline
                                                        />
                                                    </>
                                                )}

                                                <OperationListPerfData operation={operation} />

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
