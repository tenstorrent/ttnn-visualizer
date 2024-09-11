// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Button, ButtonGroup, Icon, Intent, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import SearchField from './SearchField';
import LoadingSpinner from './LoadingSpinner';
import 'styles/components/OperationsList.scss';
import { useOperationsList, useTensors } from '../hooks/useAPI';
import ROUTES from '../definitions/routes';
import { Tensor } from '../model/Graph';
import { OperationDescription } from '../model/APIData';
import { BufferTypeLabel } from '../model/BufferType';
import Collapsible from './Collapsible';
import BufferTable from './BufferTable';
import { expandedTensorsAtom } from '../store/app';
import ListItem from './ListItem';

const PLACEHOLDER_ARRAY_SIZE = 10;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Height in px of 'scroll-shade' pseudo elements

const TensorList = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { data: operations } = useOperationsList();
    const { data: fetchedTensors, error, isLoading } = useTensors();
    const scrollElementRef = useRef(null);
    const [shouldCollapseAll, setShouldCollapseAll] = useState(false);
    const [filterQuery, setFilterQuery] = useState('');
    const [memoryLeakCount, setMemoryLeakCount] = useState(0);
    const [filteredTensorList, setFilteredTensorList] = useState<Tensor[]>([]);
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

    const [expandedTensors, setExpandedTensors] = useAtom(expandedTensorsAtom);

    const virtualizer = useVirtualizer({
        count: filteredTensorList?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
    });
    const virtualItems = virtualizer.getVirtualItems();
    const numberOfTensors =
        filteredTensorList && filteredTensorList.length >= 0 ? filteredTensorList.length : PLACEHOLDER_ARRAY_SIZE;

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
        let count = 0;

        if (operations) {
            filteredTensorList.forEach((tensor) => {
                const deallocationOperation = getDeallocation(tensor, operations);
                if (deallocationOperation) {
                    count++;
                }
            });
        }

        setMemoryLeakCount(count);
    }, [operations, filteredTensorList]);

    useMemo(() => {
        if (fetchedTensors && operations) {
            let tensors = [...fetchedTensors];

            if (filterQuery) {
                tensors = fetchedTensors?.filter((tensor) =>
                    getTensorFilterName(tensor).toLowerCase().includes(filterQuery.toLowerCase()),
                );
            }

            setFilteredTensorList(tensors);
        }
    }, [operations, fetchedTensors, filterQuery]);

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

    return (
        <fieldset className='operations-wrap'>
            <legend>Tensors</legend>

            <div className='list-controls'>
                <SearchField
                    placeholder='Filter tensors'
                    searchQuery={filterQuery}
                    onQueryChanged={(value) => setFilterQuery(value)}
                />

                <ButtonGroup minimal>
                    <Tooltip
                        content={shouldCollapseAll ? 'Collapse all' : 'Expand all'}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleExpandAllToggle()}
                            rightIcon={shouldCollapseAll ? IconNames.CollapseAll : IconNames.ExpandAll}
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
                </ButtonGroup>

                <p className='memory-leak-count'>
                    {memoryLeakCount ? (
                        <>
                            <span className='warning'>{memoryLeakCount} potential memory leaks</span>
                            <Icon
                                icon={IconNames.WARNING_SIGN}
                                intent={Intent.WARNING}
                            />
                        </>
                    ) : (
                        <>
                            <span className='success'>No memory leaks detected</span>
                            <Icon
                                icon={IconNames.TICK}
                                intent={Intent.SUCCESS}
                            />
                        </>
                    )}
                </p>

                {!isLoading && (
                    <p className='result-count'>
                        {fetchedTensors && filterQuery
                            ? `Showing ${numberOfTensors} of ${fetchedTensors.length} tensors`
                            : `Showing ${numberOfTensors} tensors`}
                    </p>
                )}
            </div>

            <div
                ref={scrollElementRef}
                className={classNames('scrollable-element', {
                    'scroll-shade-top': hasScrolledFromTop,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfTensors > virtualItems.length,
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
                        className='operations-list'
                        style={{
                            // Tracks scroll position
                            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                        }}
                    >
                        {operations && filteredTensorList?.length ? (
                            virtualItems.map((virtualRow) => {
                                const tensor = filteredTensorList[virtualRow.index];
                                const deallocationOperation = getDeallocation(tensor, operations);

                                return (
                                    <li
                                        className='operation'
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
                                                    intent={Intent.PRIMARY}
                                                />
                                            }
                                            additionalElements={
                                                !deallocationOperation ? (
                                                    <Icon
                                                        icon={IconNames.WARNING_SIGN}
                                                        intent={Intent.WARNING}
                                                    />
                                                ) : undefined
                                            }
                                        >
                                            <BufferTable
                                                tensor={tensor}
                                                operations={operations}
                                                queryKey={virtualRow.index.toString()}
                                            />
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

function getTensorFilterName(tensor: Tensor) {
    const bufferTypeLabel =
        Number.isInteger(tensor.buffer_type) && tensor.buffer_type !== null
            ? BufferTypeLabel[tensor.buffer_type]
            : '(?)';

    return `Tensor ${tensor.id} ${bufferTypeLabel}`;
}

function getDeallocation(tensor: Tensor, operations: OperationDescription[]) {
    // TODO: Maybe we can strengthen this logic to ensure we're looking at deallocations
    const matchingInputs = operations.filter(
        (operation) =>
            operation.name.includes('deallocate') && operation.inputs.find((input) => input.id === tensor.id),
    );

    return matchingInputs.map((x) => x.id).toString() || '';
}

export default TensorList;
