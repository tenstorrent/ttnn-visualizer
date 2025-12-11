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
import 'styles/components/OperationsListComponent.scss';
import { useGetUniqueDeviceOperationsList, useOperationsList } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import { activePerformanceReportAtom, selectedOperationRangeAtom, shouldCollapseAllOperationsAtom } from '../store/app';
import { OperationDescription } from '../model/APIData';
import ListItem from './ListItem';
import { formatSize } from '../functions/math';
import OperationListPerfData from './OperationListPerfData';
import StackTrace from './operation-details/StackTrace';
import useRestoreScrollPosition from '../hooks/useRestoreScrollPosition';
import { ScrollLocations } from '../definitions/ScrollPositions';
import { StackTraceLanguage } from '../definitions/StackTrace';
import useScrollShade from '../hooks/useScrollShade';
import SimpleMultiselect from './SimpleMultiselect';

const PLACEHOLDER_ARRAY_SIZE = 50;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Total height in px of 'scroll-shade' pseudo elements

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
    const [shouldSortByID, setShouldSortByID] = useState<SortingOptions>(SortingOptions.ASCENDING);
    const [shouldSortDuration, setShouldSortDuration] = useState<SortingOptions>(SortingOptions.OFF);
    const [focusedRow, setFocusedRow] = useState<number | null>(null);
    const [expandedItems, setExpandedItems] = useState<number[]>([]);

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
    const [selectedDeviceOperations, setSelectedDeviceOperations] = useState<string[]>([]);

    const filterDeviceOperations = (list: string[]) => {
        setSelectedDeviceOperations(list);
    };

    const filteredOperationsList = useMemo(() => {
        if (operationsWithRange) {
            let operations = [...operationsWithRange];

            if (filterQuery) {
                operations = operationsWithRange?.filter((operation) =>
                    getOperationFilterName(operation).toLowerCase().includes(filterQuery.toLowerCase()),
                );
            }

            if (selectedDeviceOperations.length) {
                operations = operations.filter((operation) =>
                    operation.deviceOperationNameList.some((opName) => selectedDeviceOperations.includes(opName)),
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
        itemCount: restoredItemCount,
        scrollOffset: restoredOffset,
        measurementsCache: restoredMeasurementsCache,
        expandedItems: restoredExpandedItems,
    } = useMemo(() => getListState(), [getListState]) ?? {};

    const virtualizer = useVirtualizer({
        estimateSize: () => OPERATION_EL_HEIGHT,
        getScrollElement: () => scrollElementRef.current,
        overscan: 10,
        initialMeasurementsCache: restoredMeasurementsCache,
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
        setShouldSortByID(
            shouldSortByID === SortingOptions.ASCENDING ? SortingOptions.DESCENDING : SortingOptions.ASCENDING,
        );
    }, [shouldSortByID]);

    const handleSortByDuration = useCallback(() => {
        setShouldSortByID(SortingOptions.OFF);
        setShouldSortDuration(
            shouldSortDuration === SortingOptions.ASCENDING ? SortingOptions.DESCENDING : SortingOptions.ASCENDING,
        );
    }, [shouldSortDuration]);

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
                itemCount: filteredOperationsList?.length || PLACEHOLDER_ARRAY_SIZE,
                scrollOffset: scrollOffsetRef.current || 0,
                measurementsCache: measurementsCacheRef.current,
                expandedItems: expandedItemsRef.current,
            });
        };
    }, [updateListState, filteredOperationsList]);

    return (
        // TODO: Turn this into a generation ListView component used by OperationList and TensorList
        <fieldset className='list-wrap operations-list-component'>
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

                <SimpleMultiselect
                    label='Device Operations'
                    optionList={uniqueDeviceOperationNames || []}
                    onUpdateHandler={filterDeviceOperations}
                />

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

                                                <ul className='device-operations-list'>
                                                    {operation.deviceOperationNameList.map((op: string, index) => {
                                                        return <li key={operation.id + op + index}>{op}()</li>;
                                                    })}
                                                </ul>

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
