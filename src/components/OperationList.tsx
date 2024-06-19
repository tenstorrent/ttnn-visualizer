// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { useRef, useState } from 'react';
import axios, { AxiosError } from 'axios';
import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import SearchField from './SearchField';
import Collapsible from './Collapsible';
import OperationComponent from './OperationComponent';
import { Operation } from '../model/Graph';
import OperationArguments from './OperationArguments';
import 'styles/components/OperationsList.scss';
import LoadingSpinner from './LoadingSpinner';

const PLACEHOLDER_ARRAY_SIZE = 10;

const OperationList = () => {
    const [filterQuery, setFilterQuery] = useState('');
    const [expandedOperations, setExpandedOperations] = useState<number[]>([]);

    const fetchOperations = async () => {
        const { data } = await axios.get('/api/get-operations');
        return data;
    };
    const { data, error, isLoading } = useQuery<Operation[], AxiosError>('get-operations', fetchOperations);

    const filteredData = data && filterQuery ? data?.filter((entry) => entry.name.includes(filterQuery)) : data;

    const parentRef = useRef(null);
    const virtualizer = useVirtualizer({
        count: filteredData?.length || PLACEHOLDER_ARRAY_SIZE,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 39,
    });
    const virtualItems = virtualizer.getVirtualItems();
    const count = filteredData?.length || PLACEHOLDER_ARRAY_SIZE;

    function onClickItem(operationId: number) {
        setExpandedOperations((currentValues) => {
            const array = [...currentValues];

            if (array.includes(operationId)) {
                return array.filter((entry) => entry !== operationId);
            }

            array.push(operationId);
            return array;
        });
    }

    return (
        <div className='app'>
            <fieldset className='operations-wrap'>
                <legend>Operations</legend>

                <div className='list-controls'>
                    <SearchField
                        placeholder='Filter operations'
                        searchQuery={filterQuery}
                        onQueryChanged={(value) => setFilterQuery(value)}
                    />
                    <button
                        type='button'
                        onClick={() => {
                            virtualizer.scrollToIndex(0);
                        }}
                    >
                        Go to Start
                    </button>
                    <button
                        type='button'
                        onClick={() => {
                            virtualizer.scrollToIndex(count - 1);
                        }}
                    >
                        Go to End
                    </button>
                </div>

                <div ref={parentRef} className='scrollable-element'>
                    <div
                        style={{
                            // Div is sized to the maximum required to render all list items
                            height: virtualizer.getTotalSize(),
                        }}
                    >
                        <ul
                            className='operations-list'
                            style={{
                                // Tracks scroll position
                                transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                            }}
                        >
                            {filteredData?.length ? (
                                virtualItems.map((virtualRow) => {
                                    const operation = filteredData[virtualRow.index];

                                    return (
                                        <li
                                            className='operation'
                                            key={virtualRow.index}
                                            data-index={virtualRow.index}
                                            ref={virtualizer.measureElement}
                                        >
                                            <Collapsible
                                                onClick={() => onClickItem(operation.id)}
                                                label={
                                                    <OperationComponent
                                                        operation={operation}
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
                                    {isLoading ? <LoadingSpinner /> : <p>No results.</p>}
                                    {error && <div>An error occurred: {error.message}</div>}
                                </>
                            )}
                        </ul>
                    </div>
                </div>
            </fieldset>
        </div>
    );
};

export default OperationList;
