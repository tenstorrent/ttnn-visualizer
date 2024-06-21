// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { UIEvent, useMemo, useRef, useState } from 'react';
import axios, { AxiosError } from 'axios';
import { Button, ButtonGroup, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import classNames from 'classnames';
import { useVirtualizer } from '@tanstack/react-virtual';
import SearchField from './SearchField';
import Collapsible from './Collapsible';
import OperationComponent from './OperationComponent';
import { Operation } from '../model/Graph';
import OperationArguments from './OperationArguments';
import LoadingSpinner from './LoadingSpinner';
import 'styles/components/OperationsList.scss';

const PLACEHOLDER_ARRAY_SIZE = 10;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Height in px of 'scroll-shade' pseudo elements

const OperationList = () => {
    const [filterQuery, setFilterQuery] = useState('');
    const [filteredOperationsList, setFilteredOperationsList] = useState<Operation[]>([]);
    const [expandedOperations, setExpandedOperations] = useState<number[]>([]);
    const [shouldSortDescending, setShouldSortDescending] = useState(false);
    const [shouldCollapseAll, setShouldCollapseAll] = useState(false);
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

    const fetchOperations = async () => {
        const { data: operationList } = await axios.get('/api/get-operations');

        return operationList;
    };
    const { data, error, isLoading } = useQuery<Operation[], AxiosError>('get-operations', fetchOperations);

    const scrollElementRef = useRef(null);
    const virtualizer = useVirtualizer({
        count: filteredOperationsList?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => scrollElementRef.current,
        estimateSize: () => OPERATION_EL_HEIGHT,
    });
    const virtualItems = virtualizer.getVirtualItems();
    const numberOfOperations =
        filteredOperationsList && filteredOperationsList.length >= 0
            ? filteredOperationsList.length
            : PLACEHOLDER_ARRAY_SIZE;

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

    const handleReversingList = () => {
        setShouldSortDescending((shouldSort) => !shouldSort);
    };

    const handleExpandAllToggle = () => {
        setShouldCollapseAll((shouldCollapse) => !shouldCollapse);
        setExpandedOperations(
            !shouldCollapseAll && filteredOperationsList ? filteredOperationsList.map((operation) => operation.id) : [],
        );
    };

    const handleUserScrolling = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;

        setHasScrolledFromTop(!(el.scrollTop < OPERATION_EL_HEIGHT / 2));
        setHasScrolledToBottom(el.scrollTop + el.offsetHeight >= el.scrollHeight);
    };

    // TODO: I think we can handle this via useMutation in React Query but this works for now
    useMemo(() => {
        if (data) {
            let operations = [...data];

            if (filterQuery) {
                operations = data?.filter((operation) =>
                    getOperationFilterName(operation).toLowerCase().includes(filterQuery.toLowerCase()),
                );
            }

            if (shouldSortDescending) {
                operations = operations.reverse();
            }

            setFilteredOperationsList(operations);
        }
    }, [data, filterQuery, shouldSortDescending]);

    return (
        <fieldset className='operations-wrap'>
            <legend>Operations</legend>

            <div className='list-controls'>
                <SearchField
                    placeholder='Filter operations'
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
                        content={shouldSortDescending ? 'Sort ascending' : 'Sort descending'}
                        placement={PopoverPosition.TOP}
                    >
                        <Button
                            onClick={() => handleReversingList()}
                            icon={shouldSortDescending ? IconNames.SortAlphabeticalDesc : IconNames.SortAlphabetical}
                        />
                    </Tooltip>

                    <Tooltip content='Scroll to top' placement={PopoverPosition.TOP}>
                        <Button
                            onClick={() => {
                                virtualizer.scrollToIndex(0);
                            }}
                            icon={IconNames.DOUBLE_CHEVRON_UP}
                        />
                    </Tooltip>

                    <Tooltip content='Scroll to bottom' placement={PopoverPosition.TOP}>
                        <Button
                            onClick={() => {
                                virtualizer.scrollToIndex(numberOfOperations - 1);
                            }}
                            icon={IconNames.DOUBLE_CHEVRON_DOWN}
                        />
                    </Tooltip>
                </ButtonGroup>

                {!isLoading && (
                    <p className='result-count'>
                        {data && filterQuery
                            ? `Showing ${numberOfOperations} of ${data.length} operations`
                            : `Showing ${numberOfOperations} operations`}
                    </p>
                )}
            </div>

            <div
                ref={scrollElementRef}
                className={classNames('scrollable-element', {
                    'scroll-shade-top': hasScrolledFromTop,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfOperations > virtualItems.length,
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
                        {filteredOperationsList?.length ? (
                            virtualItems.map((virtualRow) => {
                                const operation = filteredOperationsList[virtualRow.index];

                                return (
                                    <li
                                        className='operation'
                                        key={virtualRow.index}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                    >
                                        <Collapsible
                                            onExpandToggle={() => handleToggleCollapsible(operation.id)}
                                            label={
                                                <OperationComponent
                                                    filterName={getOperationFilterName(operation)}
                                                    filterQuery={filterQuery}
                                                />
                                            }
                                            keepChildrenMounted={false}
                                            additionalElements={
                                                <Link to={`/operations/${operation.id}`}>
                                                    <Button
                                                        title='Buffer view'
                                                        minimal
                                                        small
                                                        className='buffer-view'
                                                        icon={IconNames.SEGMENTED_CONTROL}
                                                    />
                                                </Link>
                                            }
                                            isOpen={expandedOperations.includes(operation.id)}
                                        >
                                            <div className='arguments-wrapper'>
                                                {operation.arguments && (
                                                    <OperationArguments
                                                        operationId={operation.id}
                                                        data={operation.arguments}
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

function getOperationFilterName(operation: Operation) {
    return `${operation.id.toString()} ${operation.name}`;
}

export default OperationList;
