// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Button, ButtonGroup, PopoverPosition, Tooltip } from '@blueprintjs/core';
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
import { DeviceOperationMapping, useGetDeviceOperationListPerf, useOperationsList } from '../hooks/useAPI';
import ROUTES from '../definitions/Routes';
import { expandedOperationsAtom, selectedOperationRangeAtom, shouldCollapseAllOperationsAtom } from '../store/app';
import { OperationDescription } from '../model/APIData';
import ListItem from './ListItem';
import { formatSize } from '../functions/math';

const PLACEHOLDER_ARRAY_SIZE = 10;
const OPERATION_EL_HEIGHT = 39; // Height in px of each list item
const TOTAL_SHADE_HEIGHT = 100; // Height in px of 'scroll-shade' pseudo elements

enum SortingOptions {
    OFF,
    ASCENDING,
    DESCENDING,
}

const OperationList = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { data: fetchedOperations, error, isLoading } = useOperationsList();
    const perfData = useGetDeviceOperationListPerf();
    const scrollElementRef = useRef<HTMLDivElement>(null);

    const [filterQuery, setFilterQuery] = useState('');
    const [filteredOperationsList, setFilteredOperationsList] = useState<OperationDescription[]>([]);
    const [shouldSortByID, setShouldSortByID] = useState<SortingOptions>(SortingOptions.ASCENDING);
    const [shouldSortDuration, setShouldSortDuration] = useState<SortingOptions>(SortingOptions.OFF);
    const [hasScrolledFromTop, setHasScrolledFromTop] = useState(false);
    const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
    const [shouldCollapseAll, setShouldCollapseAll] = useAtom(shouldCollapseAllOperationsAtom);
    const [expandedOperations, setExpandedOperations] = useAtom(expandedOperationsAtom);
    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);

    // TODO: Figure out an initial scroll position based on last used operation
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
    const virtualHeight = virtualizer.getTotalSize() - TOTAL_SHADE_HEIGHT;

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
        setExpandedOperations(
            !shouldCollapseAll && filteredOperationsList ? filteredOperationsList.map((operation) => operation.id) : [],
        );
    };

    const handleUserScrolling = (event: UIEvent<HTMLDivElement>) => {
        const el = event.currentTarget;

        setHasScrolledFromTop(!(el.scrollTop < OPERATION_EL_HEIGHT / 2));
        setHasScrolledToBottom(el.scrollTop + el.offsetHeight >= el.scrollHeight);
    };

    useMemo(() => {
        if (fetchedOperations) {
            let operations = [...fetchedOperations];

            if (filterQuery) {
                operations = fetchedOperations?.filter((operation) =>
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

        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fetchedOperations, filterQuery, shouldSortByID, shouldSortDuration, perfData, selectedOperationRange]);

    useEffect(() => {
        const initialOperationId = location.state?.previousOperationId;

        if (initialOperationId && virtualizer) {
            const operationIndex =
                fetchedOperations?.findIndex(
                    (operation: OperationDescription) => operation.id === parseInt(initialOperationId, 10),
                ) || 0;

            // Looks better if we scroll to the previous index
            virtualizer.scrollToIndex(operationIndex - 1, {
                align: 'start',
            });

            // Navigating to the same page replaces the entry in the browser history
            // TODO: Revisit this code later to make sure it's not causing any weird side effects
            navigate(ROUTES.OPERATIONS, { replace: true });
        }
    }, [virtualizer, fetchedOperations, location, navigate]);

    useEffect(() => {
        if (virtualHeight <= 0 && scrollElementRef.current) {
            scrollElementRef.current.scrollTop = 0;
            setHasScrolledFromTop(false);
        }
    }, [virtualHeight]);

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
                            outlined={isSortingModeActive(shouldSortByID)}
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
                            outlined={isSortingModeActive(shouldSortDuration)}
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
                                virtualizer.scrollToIndex(numberOfOperations - 1);
                            }}
                            icon={IconNames.DOUBLE_CHEVRON_DOWN}
                        />
                    </Tooltip>
                </ButtonGroup>

                {!isLoading && (
                    <p className='result-count'>
                        {fetchedOperations && filterQuery
                            ? `Showing ${numberOfOperations} of ${fetchedOperations.length} operations`
                            : `Showing ${numberOfOperations} operations`}
                    </p>
                )}
            </div>

            <div
                ref={scrollElementRef}
                className={classNames('scrollable-element', {
                    'scroll-shade-top': hasScrolledFromTop && virtualHeight >= 0,
                    'scroll-shade-bottom': !hasScrolledToBottom && numberOfOperations > virtualItems.length,
                    'scroll-lock': virtualHeight <= 0,
                })}
                onScroll={(event) => handleUserScrolling(event)}
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
                                        className='list-item-container'
                                        key={virtualRow.key}
                                        data-index={virtualRow.index}
                                        ref={virtualizer.measureElement}
                                    >
                                        <Collapsible
                                            onExpandToggle={() => handleToggleCollapsible(operation.id)}
                                            label={
                                                <ListItem
                                                    filterName={getOperationFilterName(operation)}
                                                    filterQuery={filterQuery}
                                                    icon={IconNames.CUBE}
                                                    iconColour='operation'
                                                />
                                            }
                                            keepChildrenMounted={false}
                                            additionalElements={
                                                <Button
                                                    title='Buffer view'
                                                    minimal
                                                    small
                                                    className='buffer-view'
                                                    icon={IconNames.SEGMENTED_CONTROL}
                                                    onClick={() => navigate(`${ROUTES.OPERATIONS}/${operation.id}`)}
                                                />
                                            }
                                            isOpen={expandedOperations.includes(operation.id)}
                                        >
                                            <div className='arguments-wrapper'>
                                                <p className='monospace'>
                                                    Python execution time: {formatSize(operation.duration)} s
                                                </p>
                                                <p className='monospace'>
                                                    {perfData
                                                        ?.filter(
                                                            (perf: DeviceOperationMapping) => perf.id === operation.id,
                                                        )
                                                        .map(
                                                            (perf) =>
                                                                perf.perfData && (
                                                                    <p key={perf.id + perf.operationName}>
                                                                        <strong>{perf.perfData?.['OP CODE']}</strong>{' '}
                                                                        Device time:{' '}
                                                                        {formatSize(
                                                                            Number(
                                                                                perf.perfData?.[
                                                                                    'DEVICE KERNEL DURATION [ns]'
                                                                                ],
                                                                            ) / 1000,

                                                                            0,
                                                                        )}{' '}
                                                                        µs
                                                                    </p>
                                                                ),
                                                        )}
                                                </p>

                                                {operation.arguments && (
                                                    <OperationArguments
                                                        operation={operation}
                                                        operationIndex={virtualRow.index}
                                                        onCollapseTensor={virtualizer.scrollToIndex}
                                                    />
                                                )}

                                                {/* {operation?.device_operations && (
                                                    <DeviceOperations deviceOperations={operation.device_operations} />
                                                )} */}
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
