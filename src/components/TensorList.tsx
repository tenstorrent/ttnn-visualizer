// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, ButtonGroup, ButtonVariant, Icon, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import SearchField from './SearchField';
import LoadingSpinner from './LoadingSpinner';
import {
    useGetTensorDeallocationReportByOperation,
    useOperationsList,
    useTensorListById,
    useTensors,
} from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import { Tensor } from '../model/APIData';
import { BufferTypeLabel } from '../model/BufferType';
import Collapsible from './Collapsible';
import { selectedOperationRangeAtom, shouldCollapseAllTensorsAtom, tensorBufferTypeFiltersAtom } from '../store/app';
import ListItem from './ListItem';
import '@blueprintjs/select/lib/css/blueprint-select.css';
import 'styles/components/ListView.scss';
import BufferDetails from './BufferDetails';
import isValidNumber from '../functions/isValidNumber';
import { MAX_NUM_CONSUMERS } from '../definitions/ProducersConsumers';
import { convertBytes, toReadableShape, toReadableType } from '../functions/math';
import MultiSelectField from './MultiSelectField';
import { ScrollLocations } from '../definitions/ScrollPositions';
import useRestoreScrollPosition from '../hooks/useRestoreScrollPosition';
import useScrollShade from '../hooks/useScrollShade';

const PLACEHOLDER_ARRAY_SIZE = 50;
const OPERATION_EL_HEIGHT = 39; // Estimated size of each element in px
const TOTAL_SHADE_HEIGHT = 100; // Total height in px of 'scroll-shade' pseudo elements
const HIGH_CONSUMER_INTENT = Intent.DANGER;

enum SortingOptions {
    OFF,
    ASCENDING,
    DESCENDING,
}

const TensorList = () => {
    const [shouldCollapseAll, setShouldCollapseAll] = useAtom(shouldCollapseAllTensorsAtom);
    const [bufferTypeFilters, setBufferTypeFilters] = useAtom(tensorBufferTypeFiltersAtom);
    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);
    const [shouldSortByDuration, setShouldSortByDuration] = useState<SortingOptions>(SortingOptions.OFF);

    const [filterQuery, setFilterQuery] = useState('');
    const [showHighConsumerTensors, setShowHighConsumerTensors] = useState(false);
    const [showLateDeallocatedTensors, setShowLateDeallocatedTensors] = useState(false);
    const [expandedItems, setExpandedItems] = useState<number[]>([]);

    const location = useLocation();
    const navigate = useNavigate();
    const { data: operations, isLoading: isOperationsLoading } = useOperationsList();
    const { data: fetchedTensors, error, isLoading: isTensorsLoading } = useTensors();
    const { getListState, updateListState } = useRestoreScrollPosition(ScrollLocations.TENSOR_LIST);
    const { nonDeallocatedTensorList } = useGetTensorDeallocationReportByOperation();
    const { hasScrolledFromTop, hasScrolledToBottom, updateScrollShade, resetScrollShade, shadeClasses } =
        useScrollShade();
    const scrollElementRef = useRef<HTMLDivElement>(null);
    const tensorListById = useTensorListById();

    const tensorsWithRange = useMemo(() => {
        if (fetchedTensors && selectedOperationRange) {
            return fetchedTensors.filter(
                (tensor) =>
                    (tensor.producers.some((producer) => producer >= selectedOperationRange[0]) &&
                        tensor.producers.some((producer) => producer <= selectedOperationRange[1])) ||
                    (tensor.consumers.some((consumer) => consumer >= selectedOperationRange[0]) &&
                        tensor.consumers.some((consumer) => consumer <= selectedOperationRange[1])),
            );
        }

        return fetchedTensors;
    }, [fetchedTensors, selectedOperationRange]);

    const filteredTensorsList = useMemo(() => {
        if (tensorsWithRange) {
            let tensors = [...tensorsWithRange];

            if (filterQuery) {
                tensors = tensorsWithRange?.filter((tensor) =>
                    getTensorFilterName(tensor).toLowerCase().includes(filterQuery.toLowerCase()),
                );
            }

            if (bufferTypeFilters && bufferTypeFilters?.length > 0) {
                tensors = tensors.filter(
                    (tensor) => tensor?.buffer_type !== null && bufferTypeFilters.includes(tensor.buffer_type),
                );
            }

            if (showHighConsumerTensors) {
                tensors = tensors.filter((tensor) => tensor.consumers.length > MAX_NUM_CONSUMERS);
            }

            if (showLateDeallocatedTensors) {
                tensors = tensors.filter((tensor) => nonDeallocatedTensorList.get(tensor.id));
            }

            if (shouldSortByDuration !== SortingOptions.OFF) {
                tensors.sort((a, b) => {
                    const sizeA = a.address ? tensorListById.get(a.address)?.size : undefined;
                    const sizeB = b.address ? tensorListById.get(b.address)?.size : undefined;

                    if (!isValidNumber(sizeA) || !isValidNumber(sizeB)) {
                        return 0;
                    }

                    if (shouldSortByDuration === SortingOptions.ASCENDING) {
                        return sizeA - sizeB;
                    }

                    return sizeB - sizeA;
                });
            }

            return tensors;
        }

        return [];
    }, [
        tensorsWithRange,
        filterQuery,
        bufferTypeFilters,
        showHighConsumerTensors,
        showLateDeallocatedTensors,
        nonDeallocatedTensorList,
        shouldSortByDuration,
        tensorListById,
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
        count: filteredTensorsList?.length || PLACEHOLDER_ARRAY_SIZE,
        initialOffset: restoredOffset || 0,
    });

    const virtualItems = virtualizer.getVirtualItems();
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;
    const numberOfTensors = filteredTensorsList.length || PLACEHOLDER_ARRAY_SIZE;

    // Store latest values in refs for unmount cleanup
    const scrollOffsetRef = useRef(virtualizer.scrollOffset);
    const measurementsCacheRef = useRef(virtualizer.measurementsCache);
    const expandedItemsRef = useRef(expandedItems);

    const handleUserScrolling = useCallback(() => {
        if (scrollElementRef.current) {
            updateScrollShade(scrollElementRef.current);
        }
    }, [updateScrollShade]);

    const handleToggleCollapsible = useCallback((operationId: number) => {
        setExpandedItems((currentExpanded) => {
            const newList = currentExpanded || [];
            return newList.includes(operationId)
                ? newList.filter((id) => id !== operationId)
                : [...newList, operationId];
        });
    }, []);

    const handleExpandAllToggle = useCallback(() => {
        setShouldCollapseAll((shouldCollapse) => !shouldCollapse);
        setExpandedItems(
            !shouldCollapseAll && filteredTensorsList ? filteredTensorsList.map((tensor) => tensor.id) : [],
        );
    }, [filteredTensorsList, shouldCollapseAll, setShouldCollapseAll]);

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

    // Restore expanded items on mount
    useEffect(() => {
        // Update stored list state on unmount
        return () => {
            updateListState({
                scrollOffset: scrollOffsetRef.current || 0,
                measurementsCache: measurementsCacheRef.current,
                expandedItems: expandedItemsRef.current,
            });
        };
    }, [updateListState]);

    // Restore expanded items on mount
    useEffect(() => {
        setExpandedItems(restoredExpandedItems || []);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const initialTensorId = location.state?.previousOperationId;
        if (initialTensorId && virtualizer) {
            const operationIndex =
                fetchedTensors?.findIndex((tensor: Tensor) => tensor.id === parseInt(initialTensorId, 10)) || 0;
            // Looks better if we scroll to the previous index
            virtualizer.scrollToIndex(operationIndex - 1, {
                align: 'start',
            });
            // Navigating to the same page replaces the entry in the browser history
            navigate(ROUTES.OPERATIONS, { replace: true });
        }
    }, [virtualizer, fetchedTensors, location, navigate]);

    useEffect(() => {
        if (virtualHeight <= 0 && scrollElementRef.current) {
            scrollElementRef.current.scrollTop = 0;
            resetScrollShade();
        } else if (scrollElementRef.current) {
            updateScrollShade(scrollElementRef.current);
        }
    }, [virtualHeight, updateScrollShade, resetScrollShade]);

    return (
        // TODO: Turn this into a generation ListView component used by OperationList and TensorList
        <fieldset className='list-wrap'>
            <legend>Tensors</legend>

            <div className='list-controls'>
                <SearchField
                    placeholder='Filter tensors'
                    searchQuery={filterQuery}
                    onQueryChanged={(value) => setFilterQuery(value)}
                />

                <ButtonGroup variant={ButtonVariant.MINIMAL}>
                    <Tooltip
                        content='Toggle high consumer tensors'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => setShowHighConsumerTensors(!showHighConsumerTensors)}
                            endIcon={IconNames.ISSUE}
                            disabled={!tensorsWithRange?.some((tensor) => tensor.consumers.length > MAX_NUM_CONSUMERS)}
                            intent={HIGH_CONSUMER_INTENT}
                            variant={showHighConsumerTensors ? ButtonVariant.OUTLINED : undefined}
                            aria-label='Toggle high consumer tensors'
                        >
                            {
                                filteredTensorsList?.filter((tensor) => tensor.consumers.length > MAX_NUM_CONSUMERS)
                                    .length
                            }
                        </Button>
                    </Tooltip>

                    <Tooltip
                        content='Show late deallocated tensors'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => setShowLateDeallocatedTensors(!showLateDeallocatedTensors)}
                            endIcon={IconNames.OUTDATED}
                            intent={Intent.WARNING}
                            disabled={nonDeallocatedTensorList.size === 0}
                            variant={showLateDeallocatedTensors ? ButtonVariant.OUTLINED : undefined}
                            aria-label='Toggle high consumer tensors'
                        >
                            {filteredTensorsList?.filter((tensor) => nonDeallocatedTensorList.get(tensor.id)).length}
                        </Button>
                    </Tooltip>
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
                        content='Scroll to top'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => {
                                virtualizer.scrollToIndex(0);
                            }}
                            icon={IconNames.DOUBLE_CHEVRON_UP}
                            aria-label='Scroll to top'
                        />
                    </Tooltip>
                    <Tooltip
                        content='Scroll to bottom'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => {
                                virtualizer.scrollToIndex(numberOfTensors - 1);
                            }}
                            icon={IconNames.DOUBLE_CHEVRON_DOWN}
                            aria-label='Scroll to bottom'
                        />
                    </Tooltip>

                    <Button
                        onClick={() =>
                            setShouldSortByDuration((current) => {
                                if (current === SortingOptions.OFF) {
                                    return SortingOptions.ASCENDING;
                                }

                                if (current === SortingOptions.DESCENDING) {
                                    return SortingOptions.OFF;
                                }

                                return SortingOptions.DESCENDING;
                            })
                        }
                        icon={
                            shouldSortByDuration === SortingOptions.ASCENDING ||
                            shouldSortByDuration === SortingOptions.OFF
                                ? IconNames.SORT_NUMERICAL
                                : IconNames.SORT_NUMERICAL_DESC
                        }
                        variant={shouldSortByDuration !== SortingOptions.OFF ? ButtonVariant.OUTLINED : undefined}
                        aria-label='Sort tensors by size'
                    />

                    <MultiSelectField<Tensor, 'buffer_type'>
                        keyName='buffer_type'
                        options={tensorsWithRange || []}
                        placeholder='Buffer type filter...'
                        values={bufferTypeFilters}
                        updateHandler={setBufferTypeFilters}
                        labelFormatter={(value) => (value === null ? 'Unknown' : BufferTypeLabel[value])}
                    />
                </ButtonGroup>

                {!isTensorsLoading && !isOperationsLoading ? (
                    <p className='result-count'>
                        {tensorsWithRange && (filterQuery || bufferTypeFilters)
                            ? `Showing ${numberOfTensors} of ${tensorsWithRange.length} tensors`
                            : `Showing ${numberOfTensors} tensors`}
                    </p>
                ) : null}
            </div>

            <div
                ref={scrollElementRef}
                className={classNames('scrollable-element', {
                    [shadeClasses.top]: hasScrolledFromTop && virtualHeight >= 0,
                    [shadeClasses.bottom]: !hasScrolledToBottom && numberOfTensors > virtualItems.length,
                })}
                onScroll={handleUserScrolling}
            >
                <div
                    style={{
                        // Div is sized to the maximum required to render all list items minus our shade element heights
                        height: virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT,
                    }}
                >
                    <ul
                        className='list-container'
                        style={{
                            // Tracks scroll position
                            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                        }}
                    >
                        {operations && filteredTensorsList?.length ? (
                            virtualItems.map((virtualRow) => {
                                const tensor = filteredTensorsList[virtualRow.index];
                                const isLateDeallocated = nonDeallocatedTensorList.get(tensor.id);
                                const matchedTensor = tensorListById.get(tensor.id);

                                return (
                                    <li
                                        className='list-item-container'
                                        key={virtualRow.key}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                    >
                                        <Collapsible
                                            onExpandToggle={() => handleToggleCollapsible(tensor.id)}
                                            keepChildrenMounted={false}
                                            label={
                                                <ListItem
                                                    filterName={getTensorFilterName(tensor)}
                                                    filterQuery={filterQuery}
                                                    icon={IconNames.FLOW_LINEAR}
                                                    iconColour='tensor'
                                                    tags={
                                                        isValidNumber(tensor.buffer_type) &&
                                                        BufferTypeLabel[tensor.buffer_type]
                                                            ? [
                                                                  {
                                                                      htmlTitle: BufferTypeLabel[tensor.buffer_type],
                                                                  },
                                                              ]
                                                            : undefined
                                                    }
                                                >
                                                    {tensor.consumers.length > MAX_NUM_CONSUMERS ? (
                                                        <Tooltip
                                                            content='Unusually high number of consumers'
                                                            position={PopoverPosition.TOP}
                                                            className='high-number-consumers'
                                                        >
                                                            <Icon
                                                                icon={IconNames.ISSUE}
                                                                intent={HIGH_CONSUMER_INTENT}
                                                                title='Unusually high number of consumers'
                                                            />
                                                        </Tooltip>
                                                    ) : null}

                                                    {isLateDeallocated ? (
                                                        <Tooltip
                                                            content='Tensor has an opportunity for earlier deallocation'
                                                            position={PopoverPosition.TOP}
                                                            className='high-number-consumers'
                                                        >
                                                            <Icon
                                                                icon={IconNames.OUTDATED}
                                                                intent={Intent.WARNING}
                                                                title='Tensor has an opportunity for earlier deallocation'
                                                            />
                                                        </Tooltip>
                                                    ) : null}

                                                    {matchedTensor ? (
                                                        <>
                                                            <small>{matchedTensor.size}</small>
                                                            <small>{convertBytes(matchedTensor.size)}</small>
                                                        </>
                                                    ) : null}
                                                </ListItem>
                                            }
                                            isOpen={!!expandedItems?.includes(tensor.id)}
                                        >
                                            <div className='arguments-wrapper'>
                                                <BufferDetails
                                                    tensor={tensor}
                                                    operations={operations}
                                                />
                                            </div>
                                        </Collapsible>
                                    </li>
                                );
                            })
                        ) : (
                            <>
                                {isTensorsLoading || isOperationsLoading ? <LoadingSpinner /> : <p>No results</p>}
                                {error && <div>An error occurred: {error.message}</div>}
                            </>
                        )}
                    </ul>
                </div>
            </div>
        </fieldset>
    );
};

const getTensorFilterName = (tensor: Tensor) =>
    `${toReadableShape(tensor.shape)} ${toReadableType(tensor.dtype)} ${tensor.operationIdentifier ? `(${tensor.operationIdentifier})` : ''}`;

export default TensorList;
