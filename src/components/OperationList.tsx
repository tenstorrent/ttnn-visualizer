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

const OperationList = () => {
    const [filterQuery, setFilterQuery] = useState('');
    const [activated, setActivated] = useState<number[]>([]);

    const fetchOperations = async () => {
        const { data } = await axios.get('/api/get-operations');
        return data;
    };
    const { data, error, isLoading } = useQuery<Operation[], AxiosError>('get-operations', fetchOperations);

    const filteredData = data && filterQuery ? data?.filter((entry) => entry.name.includes(filterQuery)) : data;

    const parentRef = useRef(null);
    const virtualizer = useVirtualizer({
        count: filteredData?.length || 10,
        getScrollElement: () => parentRef.current,
        estimateSize: () => 39,
        overscan: 10,
    });
    const virtualItems = virtualizer.getVirtualItems();

    function onClickItem(operationId: number) {
        setActivated((currentValues) => {
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

                <div className='ops'>
                    <SearchField
                        placeholder='Filter operations'
                        searchQuery={filterQuery}
                        onQueryChanged={(value) => setFilterQuery(value)}
                        controls={
                            [
                                // <Tooltip2
                                //     content='Select all filtered operations'
                                //     position={PopoverPosition.RIGHT}
                                //     key='select-all-ops'
                                // >
                                //     <Button icon={IconNames.CUBE_ADD}/>
                                // </Tooltip2>,
                                // <Tooltip2
                                //     content='Deselect all filtered operations'
                                //     position={PopoverPosition.RIGHT}
                                //     key='deselect-all-ops'
                                // >
                                //     <Button
                                //         icon={IconNames.CUBE_REMOVE}
                                //
                                //     />
                                // </Tooltip2>,
                            ]
                        }
                    />
                    {isLoading && <div>Loading...</div>}
                    {error && <div>An error occurred: {error.message}</div>}
                    <div
                        ref={parentRef}
                        style={{
                            height: `400px`,
                            width: '100%',
                            overflowY: 'auto',
                            contain: 'strict',
                        }}
                    >
                        <div
                            style={{
                                height: virtualizer.getTotalSize(),
                                width: '100%',
                                position: 'relative',
                            }}
                        >
                            <div
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
                                }}
                            >
                                {filteredData?.length ? (
                                    virtualItems.map((virtualRow) => {
                                        const operation = filteredData[virtualRow.index];

                                        return (
                                            <div
                                                key={virtualRow.index}
                                                data-index={virtualRow.index}
                                                ref={virtualizer.measureElement}
                                                className={virtualRow.index % 2 ? 'ListItemOdd' : 'ListItemEven'}
                                            >
                                                <div className='op'>
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
                                                        isOpen={activated.includes(operation.id)}
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
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p>No results</p>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </fieldset>
        </div>
    );
};

export default OperationList;
