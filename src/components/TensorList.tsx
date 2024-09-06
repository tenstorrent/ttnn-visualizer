// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import classNames from 'classnames';
import { useVirtualizer } from '@tanstack/react-virtual';
import SearchField from './SearchField';
import LoadingSpinner from './LoadingSpinner';
import 'styles/components/OperationsList.scss';
import { useOperationsList, useTensors } from '../hooks/useAPI';
import ROUTES from '../definitions/routes';
import { Tensor } from '../model/Graph';
import { OperationDescription, TensorData } from '../model/APIData';
import { BufferTypeLabel } from '../model/BufferType';
import NextBuffer from './NextBuffer';

const PLACEHOLDER_ARRAY_SIZE = 10;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Height in px of 'scroll-shade' pseudo elements

const TensorList = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { data: operations } = useOperationsList();
    const { data: fetchedTensors, error, isLoading } = useTensors();
    const scrollElementRef = useRef(null);
    const [filterQuery, setFilterQuery] = useState('');
    const [filteredTensorList, setFilteredTensorList] = useState<Tensor[]>([]);
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);

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

    useMemo(() => {
        if (fetchedTensors && operations) {
            let tensors = [...fetchedTensors];

            if (filterQuery) {
                tensors = fetchedTensors?.filter((tensor) =>
                    getTensorFilterName(tensor, operations).toLowerCase().includes(filterQuery.toLowerCase()),
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

                                return (
                                    <li
                                        className='operation'
                                        key={virtualRow.index}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                        style={
                                            {
                                                // display:
                                                //     !getDeallocation(tensor, operations) &&
                                                //     Number.isInteger(tensor.buffer_type)
                                                //         ? 'block'
                                                //         : 'none',
                                            }
                                        }
                                    >
                                        Tensor {tensor.id} <br />
                                        {tensor?.address} (
                                        {tensor.buffer_type ? BufferTypeLabel[tensor.buffer_type] : 'nullType'})
                                        <br />
                                        {tensor.producers.length
                                            ? `Producers: ${tensor.producers.toString()}`
                                            : 'Producers: n/a'}
                                        <br />
                                        {tensor.consumers.length
                                            ? `Consumers: ${tensor.consumers.toString()}`
                                            : 'Consumers: n/a'}
                                        <ul>
                                            <li>
                                                {getDeallocation(tensor, operations)
                                                    ? `Deallocate found in Operation ${getDeallocation(tensor, operations).toString()}`
                                                    : 'No deallocate operation found'}
                                            </li>
                                            <li>
                                                {tensor.address && tensor.consumers.length ? (
                                                    <NextBuffer
                                                        address={tensor.address}
                                                        consumers={tensor.consumers}
                                                        queryKey={virtualRow.index}
                                                    />
                                                ) : (
                                                    'No subsequent buffer found'
                                                )}
                                            </li>
                                            <li>
                                                {operations
                                                    .filter(
                                                        (operation) =>
                                                            tensor.consumers.includes(operation.id) ||
                                                            tensor.producers.includes(operation.id),
                                                    )
                                                    .map((put) => `${put.id} ${put.name}`)
                                                    .join(', ')}
                                            </li>
                                        </ul>
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

function getTensorFilterName(tensor: TensorData, operations: OperationDescription[]) {
    return `${tensor.id.toString()} ${tensor.shape} ${getDeallocation(tensor, operations)}`;
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
