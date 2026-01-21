// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { Table2 as BlueprintTable, Cell, Column, ColumnHeaderCell, Table2 } from '@blueprintjs/table';
import { Checkbox, HotkeysProvider, Icon, InputGroup, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import HighlightedText from '../HighlightedText';
import useSortTable, { SortingDirection } from '../../hooks/useSortTable';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import { convertBytes, toHex } from '../../functions/math';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { Buffer, BufferData, BuffersByOperation } from '../../model/APIData';
import { selectedTensorAtom } from '../../store/app';
import { BufferTableFilters, ColumnKeys, Columns } from '../../definitions/BufferSummary';

interface BufferSummaryTableProps {
    buffersByOperation: BuffersByOperation[];
    tensorListByOperation: TensorsByOperationByAddress;
}

interface SummaryTableBuffer extends BufferData {
    size: number;
    operation_name: string;
    tensor_id: number;
    hexAddress: string;
}

function BufferSummaryTable({ buffersByOperation, tensorListByOperation }: BufferSummaryTableProps) {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useSortTable(Columns[0].key);
    const selectedTensor = useAtomValue(selectedTensorAtom);
    const [userSelectedRows, setUserSelectedRows] = useState<number[]>([]);
    const [showOnlySelected, setShowOnlySelected] = useState(false);
    const [mergedByDevice, setMergedByDevice] = useState(true);

    const tableRef = useRef<Table2 | null>(null);
    const filterableColumnKeys = useMemo(
        () => Columns.filter((column) => column.filterable).map((column) => column.key),
        [],
    );
    const [filters, setFilters] = useState<BufferTableFilters>(
        Object.fromEntries(filterableColumnKeys.map((key) => [key, ''] as [ColumnKeys, string])) as Record<
            ColumnKeys,
            string
        >,
    );

    const isMultiDevice = useMemo(() => {
        const allDeviceIds = new Set(buffersByOperation.flatMap((op) => op.buffers.map((buffer) => buffer.device_id)));
        return allDeviceIds.size > 1;
    }, [buffersByOperation]);

    // TODO: move this to a hook. eventually
    const uniqueBuffersByOperationList = useMemo(() => {
        return buffersByOperation.map((operation) => {
            const uniqueBuffers: Map<number, Buffer> = new Map<number, Buffer>();
            operation.buffers.forEach((buffer) => {
                const { address, size } = buffer;
                if (address) {
                    const existingBuffer = uniqueBuffers.get(address);
                    if (!existingBuffer || size > existingBuffer.size) {
                        uniqueBuffers.set(address, buffer);
                        // TODO: add device list to buffer fro rendering maybe
                    }
                }
            });
            return {
                ...operation,
                buffers: Array.from(uniqueBuffers.values()),
            };
        });
    }, [buffersByOperation]);

    const listOfBuffers = useMemo(() => {
        const targetList = mergedByDevice ? uniqueBuffersByOperationList : buffersByOperation;
        return targetList
            ?.map((operation) =>
                operation.buffers
                    .map((buffer) => ({
                        ...buffer,
                        hexAddress: toHex(buffer.address),
                        operation_id: operation.id,
                        operation_name: operation.name,
                        tensor_id: tensorListByOperation.get(operation.id)?.get(buffer.address)?.id,
                    }))
                    .flat(),
            )
            .flat() as SummaryTableBuffer[];
    }, [buffersByOperation, tensorListByOperation, uniqueBuffersByOperationList, mergedByDevice]);

    const tableColumns = useMemo(
        () => (isMultiDevice ? Columns : Columns.filter((column) => column.key !== 'device_id')),
        [isMultiDevice],
    );

    const updateColumnFilter = (key: ColumnKeys, value: string) => {
        setFilters({
            ...filters,
            [key]: value,
        });
    };

    const createColumns = () => {
        return tableColumns.map((column) => createColumn(column.key, column.name));
    };

    const createColumn = (key: ColumnKeys, label: string) => (
        <Column
            key={key}
            name={label}
            cellRenderer={createCell(key, tableRows, filters, selectedRows)}
            columnHeaderCellRenderer={() => createCellHeader(key, label)}
        />
    );

    const createCellHeader = (key: ColumnKeys, label: string) => {
        let targetSortDirection = sortDirection;

        const definition = Columns.find((column) => column.key === key);

        if (sortingColumn === key) {
            targetSortDirection = sortDirection === SortingDirection.ASC ? SortingDirection.DESC : SortingDirection.ASC;
        }

        return (
            <ColumnHeaderCell
                className='cell-header'
                name={label}
            >
                {definition?.sortable && (
                    <button
                        type='button'
                        className='sortable-table-header'
                        onClick={() => changeSorting(key)(targetSortDirection)}
                        title={label}
                    >
                        <span
                            className={classNames(
                                {
                                    'is-active': sortingColumn === key,
                                },
                                'sort-icon',
                            )}
                        >
                            <Icon
                                icon={sortDirection === SortingDirection.ASC ? IconNames.SORT_ASC : IconNames.SORT_DESC}
                            />
                        </span>
                    </button>
                )}

                {definition?.filterable && (
                    <div className='column-filter'>
                        <InputGroup
                            size={Size.SMALL}
                            asyncControl
                            onChange={(e) => updateColumnFilter(key, e.target.value)}
                            placeholder='Filter...'
                            value=''
                        />
                    </div>
                )}
            </ColumnHeaderCell>
        );
    };

    const tableRows = useMemo<SummaryTableBuffer[]>(() => {
        let filteredRows = listOfBuffers;

        if (showOnlySelected) {
            filteredRows = listOfBuffers.filter((buffer) => buffer.tensor_id === selectedTensor);
        }

        if (isFiltersActive(filters) && filterableColumnKeys) {
            filteredRows = filteredRows.filter((buffer) => {
                const isFilteredOut = Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const bufferValue = getCellText(buffer, key as ColumnKeys);

                        return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                    });

                return !isFilteredOut;
            });
        }

        // Still some awkward casting here
        return [...sortTableFields(filteredRows as [])];
    }, [listOfBuffers, sortTableFields, filterableColumnKeys, filters, selectedTensor, showOnlySelected]);

    useEffect(() => {
        if (selectedTensor) {
            setUserSelectedRows([]);
        } else {
            setShowOnlySelected(false);
        }
    }, [selectedTensor]);

    const selectedRows = useMemo(() => {
        if (userSelectedRows.length) {
            return userSelectedRows;
        }

        if (!selectedTensor) {
            return [];
        }

        const matchingBuffers = tableRows.reduce((arr: number[], buffer, index: number) => {
            if (buffer?.tensor_id === selectedTensor) {
                arr.push(index);
            }

            return arr;
        }, []);

        if (tableRef?.current?.scrollToRegion && matchingBuffers.length) {
            tableRef.current.scrollToRegion({ rows: [matchingBuffers[0], matchingBuffers[0]] });
        }

        return matchingBuffers;
    }, [tableRows, selectedTensor, userSelectedRows]);

    return tableRows ? (
        <HotkeysProvider>
            <div className='buffer-summary-table'>
                <div className='aside-container'>
                    <Tooltip
                        content={isMultiDevice ? '' : 'Merging is only available when multiple devices are present'}
                    >
                        <Checkbox
                            checked={isMultiDevice && mergedByDevice}
                            onChange={() => setMergedByDevice(!mergedByDevice)}
                            disabled={!isMultiDevice}
                        >
                            Merge buffers across devices
                        </Checkbox>
                    </Tooltip>
                </div>

                <div className='aside-container'>
                    <Checkbox
                        checked={showOnlySelected}
                        onChange={() => setShowOnlySelected(!showOnlySelected)}
                        disabled={selectedTensor === null}
                    >
                        Show selected tensor rows ({selectedRows.length})
                    </Checkbox>
                    <p className='result-count'>
                        {tableRows.length !== listOfBuffers.length
                            ? `Showing ${tableRows.length} of ${listOfBuffers.length} buffers`
                            : `Showing ${tableRows.length} buffers`}
                    </p>
                </div>

                <BlueprintTable
                    numRows={tableRows.length}
                    columnWidths={tableColumns.map((column) => column.width)}
                    enableRowResizing={false}
                    cellRendererDependencies={[sortDirection, sortingColumn, tableRows, tableRows.length]}
                    ref={tableRef}
                    getCellClipboardData={(row, col) => getCellText(tableRows[row], tableColumns[col].key)}
                >
                    {createColumns()}
                </BlueprintTable>
            </div>
        </HotkeysProvider>
    ) : (
        <LoadingSpinner />
    );
}

const getCellText = (buffer: SummaryTableBuffer, key: ColumnKeys) => {
    let textValue = buffer[key]?.toString() || '';

    if (key === 'tensor_id') {
        // Using a space character to ensure the table cell height remains consistent
        textValue = buffer?.tensor_id ? `Tensor ${buffer.tensor_id}` : '\u00A0';
    }

    if (key === 'operation_id') {
        textValue = `${buffer.operation_id} ${buffer.operation_name}`;
    }

    if (key === 'buffer_type') {
        textValue = BufferTypeLabel[buffer.buffer_type];
    }

    return textValue;
};

const createCell =
    (key: ColumnKeys, rows: SummaryTableBuffer[], filters: BufferTableFilters, selectedRows: number[]) =>
    (rowIndex: number) => (
        <Cell className={classNames({ 'row-is-active': selectedRows.includes(rowIndex) })}>
            {getCellContent(key, rowIndex, rows, filters)}
        </Cell>
    );

const getCellContent = (key: ColumnKeys, rowIndex: number, rows: SummaryTableBuffer[], filters: BufferTableFilters) => {
    const buffer = rows[rowIndex] as SummaryTableBuffer;
    const textValue = getCellText(buffer, key);

    // TODO: Format address but also allow easy filtering

    if (key === 'size') {
        return convertBytes(buffer.size, 2);
    }

    if (key === 'tensor_id') {
        return (
            <div className='operation-cell'>
                <div
                    className='memory-color-block'
                    style={{
                        backgroundColor: buffer?.tensor_id
                            ? getTensorColor(buffer.tensor_id)
                            : getBufferColor(buffer.address),
                    }}
                >
                    {/* Ensures the memory color block takes up space when the table component recalculates the width of the column */}
                    &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                </div>

                <HighlightedText
                    text={textValue}
                    filter={filters[key]}
                />
            </div>
        );
    }

    return Columns.find((column) => column.key === key)?.filterable ? (
        <HighlightedText
            text={textValue}
            filter={filters[key]}
        />
    ) : (
        textValue
    );
};

function isFiltersActive(filters: BufferTableFilters) {
    return Object.values(filters).some((filter) => filter.length > 0);
}

export default BufferSummaryTable;
