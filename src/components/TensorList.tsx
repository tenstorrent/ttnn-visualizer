// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, ButtonGroup, Icon, Intent, MenuItem, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import { MultiSelect } from '@blueprintjs/select';
import SearchField from './SearchField';
import LoadingSpinner from './LoadingSpinner';
import { useOperationsList, useTensors } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import { Tensor } from '../model/APIData';
import { BufferTypeLabel } from '../model/BufferType';
import Collapsible from './Collapsible';
import { expandedTensorsAtom, selectedOperationRangeAtom } from '../store/app';
import ListItem from './ListItem';
import '@blueprintjs/select/lib/css/blueprint-select.css';
import 'styles/components/ListView.scss';
import BufferDetails from './BufferDetails';
import isValidNumber from '../functions/isValidNumber';
import { MAX_NUM_CONSUMERS } from '../definitions/ProducersConsumers';
import { toReadableShape, toReadableType } from '../functions/math';
import useTableFilter from '../hooks/useTableFilter';

const PLACEHOLDER_ARRAY_SIZE = 10;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Height in px of 'scroll-shade' pseudo elements

const TensorList = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const scrollElementRef = useRef<HTMLDivElement>(null);

    const [shouldCollapseAll, setShouldCollapseAll] = useState(false);
    const [filterQuery, setFilterQuery] = useState('');
    const [filteredTensorList, setFilteredTensorList] = useState<Tensor[]>([]);
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [showHighConsumerTensors, setShowHighConsumerTensors] = useState(false);
    const [expandedTensors, setExpandedTensors] = useAtom(expandedTensorsAtom);
    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);

    const { data: operations, isLoading: isOperationsLoading } = useOperationsList();
    const { data: fetchedTensors, error, isLoading: isTensorsLoading } = useTensors();

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

    const { getFilterOptions, updateFilters, activeFilters, FilterItem } = useTableFilter(
        'buffer_type',
        tensorsWithRange || [],
    );

    // TODO: Figure out an initial scroll position based on last used tensor
    const virtualizer = useVirtualizer({
        count: filteredTensorList?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
    });
    const virtualItems = virtualizer.getVirtualItems();
    const numberOfTensors =
        filteredTensorList && filteredTensorList.length >= 0 ? filteredTensorList.length : PLACEHOLDER_ARRAY_SIZE;
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;

    const handleUserScrolling = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;

        setHasScrolledFromTop(!(el.scrollTop < OPERATION_EL_HEIGHT / 2));
        setHasScrolledToBottom(el.scrollTop + el.offsetHeight >= el.scrollHeight);
    };

    const handleToggleCollapsible = (operationId: number) => {
        setExpandedTensors((currentIds) => {
            const tensorIds = [...currentIds];

            if (tensorIds.includes(operationId)) {
                return tensorIds.filter((id) => id !== operationId);
            }

            tensorIds.push(operationId);
            return tensorIds;
        });
    };

    const handleExpandAllToggle = () => {
        setShouldCollapseAll((shouldCollapse) => !shouldCollapse);
        setExpandedTensors(
            !shouldCollapseAll && filteredTensorList ? filteredTensorList.map((tensor) => tensor.id) : [],
        );
    };

    useMemo(() => {
        if (tensorsWithRange && operations) {
            let tensors = [...tensorsWithRange];

            if (filterQuery) {
                tensors = tensorsWithRange?.filter((tensor) =>
                    getTensorFilterName(tensor).toLowerCase().includes(filterQuery.toLowerCase()),
                );
            }

            if (activeFilters?.length > 0) {
                tensors = tensors.filter(
                    (tensor) => tensor?.buffer_type !== null && activeFilters.includes(tensor.buffer_type),
                );
            }

            if (showHighConsumerTensors) {
                tensors = tensors.filter((tensor) => tensor.consumers.length > MAX_NUM_CONSUMERS);
            }

            setFilteredTensorList(tensors);
        }
    }, [operations, tensorsWithRange, filterQuery, activeFilters, showHighConsumerTensors]);

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
            // TODO: Revisit this code later to make sure it's not causing any weird side effects
            navigate(ROUTES.OPERATIONS, { replace: true });
        }
    }, [virtualizer, fetchedTensors, location, navigate]);

    useEffect(() => {
        if (virtualHeight <= 0 && scrollElementRef.current) {
            scrollElementRef.current.scrollTop = 0;
            setHasScrolledFromTop(false);
        }
    }, [virtualHeight]);

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

                <ButtonGroup variant='minimal'>
                    <Tooltip
                        content='Toggle high consumer tensors'
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => setShowHighConsumerTensors(!showHighConsumerTensors)}
                            endIcon={IconNames.ISSUE}
                            disabled={!tensorsWithRange?.some((tensor) => tensor.consumers.length > MAX_NUM_CONSUMERS)}
                            intent={Intent.DANGER}
                            variant={showHighConsumerTensors ? 'outlined' : undefined}
                        >
                            {filteredTensorList?.filter((tensor) => tensor.consumers.length > MAX_NUM_CONSUMERS).length}
                        </Button>
                    </Tooltip>

                    <Tooltip
                        content={shouldCollapseAll ? 'Collapse all' : 'Expand all'}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleExpandAllToggle()}
                            endIcon={shouldCollapseAll ? IconNames.CollapseAll : IconNames.ExpandAll}
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
                        />
                    </Tooltip>

                    <MultiSelect
                        items={tensorsWithRange ? (getFilterOptions() as number[]) : []}
                        placeholder='Buffer type filter...'
                        // Type requires this but it seems pointless
                        onItemSelect={(selectedType: number) => updateFilters(selectedType.toString())}
                        selectedItems={activeFilters as number[]}
                        itemRenderer={(value: number) => {
                            return FilterItem(value, BufferTypeLabel[value]);
                        }}
                        tagRenderer={(buffer: number) => {
                            return BufferTypeLabel[buffer];
                        }}
                        onRemove={(type) => updateFilters(type.toString())}
                        itemPredicate={(query, bufferType) =>
                            !query || BufferTypeLabel[bufferType].toLowerCase().includes(query.toLowerCase())
                        }
                        noResults={
                            <MenuItem
                                disabled
                                text='No results.'
                                roleStructure='listoption'
                            />
                        }
                        resetOnSelect
                    />
                </ButtonGroup>

                {!isTensorsLoading && !isOperationsLoading ? (
                    <p className='result-count'>
                        {tensorsWithRange && filterQuery
                            ? `Showing ${numberOfTensors} of ${tensorsWithRange.length} tensors`
                            : `Showing ${numberOfTensors} tensors`}
                    </p>
                ) : null}
            </div>

            <div
                ref={scrollElementRef}
                className={classNames('scrollable-element', {
                    'scroll-shade-top': hasScrolledFromTop && virtualHeight >= 0,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfTensors > virtualItems.length,
                    'scroll-lock': virtualHeight <= 0,
                })}
                onScroll={(event) => handleUserScrolling(event)}
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
                        {operations && filteredTensorList?.length ? (
                            virtualItems.map((virtualRow) => {
                                const tensor = filteredTensorList[virtualRow.index];

                                return (
                                    <li
                                        className='list-item-container'
                                        key={virtualRow.index}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                    >
                                        <Collapsible
                                            onExpandToggle={() => handleToggleCollapsible(tensor.id)}
                                            keepChildrenMounted={false}
                                            isOpen={expandedTensors.includes(tensor.id)}
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
                                                                intent={Intent.DANGER}
                                                            />
                                                        </Tooltip>
                                                    ) : null}
                                                </ListItem>
                                            }
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
    `${toReadableShape(tensor.shape)} ${toReadableType(tensor.dtype)} ${tensor.operationIdentifier ? tensor.operationIdentifier : ''}`;

export default TensorList;
