// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { Table2 as BlueprintTable, Cell, Column, ColumnHeaderCell, Table2 } from '@blueprintjs/table';
import { Checkbox, HotkeysProvider, Icon, InputGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import HighlightedText from '../HighlightedText';
import useBuffersTable, { SortingDirection } from '../../hooks/useBuffersTable';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import { toHex } from '../../functions/math';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { Buffer, BufferData } from '../../model/APIData';
import { selectedTensorAtom } from '../../store/app';

interface ColumnDefinition {
    name: string;
    key: COLUMN_KEYS;
    sortable?: boolean;
    filterable?: boolean;
}

enum COLUMN_HEADERS {
    operation_id = 'Operation',
    tensor_id = 'Tensor',
    address = 'Address',
    hexAddress = 'Address (hex)',
    size = 'Size',
    buffer_type = 'Buffer Type',
    device_id = 'Device Id',
}

type COLUMN_KEYS = keyof typeof COLUMN_HEADERS;

const COLUMNS: ColumnDefinition[] = [
    {
        name: COLUMN_HEADERS.operation_id,
        key: 'operation_id',
        sortable: true,
        filterable: true,
    },
    {
        name: COLUMN_HEADERS.tensor_id,
        key: 'tensor_id',
        sortable: true,
        filterable: true,
    },
    {
        name: COLUMN_HEADERS.address,
        key: 'address',
        sortable: true,
        filterable: true,
    },
    {
        name: COLUMN_HEADERS.hexAddress,
        key: 'hexAddress',
        sortable: true,
        filterable: true,
    },
    {
        name: COLUMN_HEADERS.size,
        key: 'size',
        sortable: true,
    },
    {
        name: COLUMN_HEADERS.buffer_type,
        key: 'buffer_type',
    },
    {
        name: COLUMN_HEADERS.device_id,
        key: 'device_id',
    },
];

interface BufferSummaryTableProps {
    buffersByOperation: BuffersByOperationData[];
    tensorListByOperation: TensorsByOperationByAddress;
}

interface SummaryTableBuffer extends BufferData {
    size: number;
    operation_name: string;
    tensor_id: number;
    hexAddress: string;
}

function BufferSummaryTable({ buffersByOperation, tensorListByOperation }: BufferSummaryTableProps) {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useBuffersTable(COLUMNS[0].key);
    const selectedTensor = useAtomValue(selectedTensorAtom);
    const [userSelectedRows, setUserSelectedRows] = useState<number[]>([]);
    const [showOnlySelected, setShowOnlySelected] = useState(false);
    const [mergedByDevice, setMergedByDevice] = useState(true);

    const tableRef = useRef<Table2 | null>(null);
    const filterableColumnKeys = useMemo(
        () => COLUMNS.filter((column) => column.filterable).map((column) => column.key),
        [],
    );
    const [filters, setFilters] = useState<Record<COLUMN_KEYS, string>>(
        Object.fromEntries(filterableColumnKeys.map((key) => [key, ''] as [COLUMN_KEYS, string])) as Record<
            COLUMN_KEYS,
            string
        >,
    );

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

    const updateColumnFilter = (key: COLUMN_KEYS, value: string) => {
        setFilters({
            ...filters,
            [key]: value,
        });
    };

    const createColumns = () => {
        return COLUMNS.map((column) => createColumn(column.key, column.name));
    };

    const createColumn = (key: COLUMN_KEYS, label: string) => (
        <Column
            key={key}
            name={label}
            cellRenderer={createCell(key, tableFields, filters, selectedRows)}
            columnHeaderCellRenderer={() => createCellHeader(key, label)}
        />
    );

    const createCellHeader = (key: COLUMN_KEYS, label: string) => {
        let targetSortDirection = sortDirection;

        const definition = COLUMNS.find((column) => column.key === key);

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
                            size='small'
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

    const tableFields = useMemo(() => {
        let filteredTableFields = listOfBuffers;

        if (showOnlySelected) {
            filteredTableFields = listOfBuffers.filter((buffer) => buffer.tensor_id === selectedTensor);
        }

        if (areFiltersActive(filters) && filterableColumnKeys) {
            filteredTableFields = listOfBuffers.filter((buffer) => {
                const isFilteredOut = Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        const bufferValue = getCellText(buffer, key as COLUMN_KEYS);

                        return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                    });

                return !isFilteredOut;
            });
        }

        return [...sortTableFields(filteredTableFields as [])] as SummaryTableBuffer[];
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

        const matchingBuffers = tableFields.reduce((arr: number[], buffer, index: number) => {
            if (buffer?.tensor_id === selectedTensor) {
                arr.push(index);
            }

            return arr;
        }, []);

        if (tableRef?.current?.scrollToRegion && matchingBuffers.length) {
            tableRef.current.scrollToRegion({ rows: [matchingBuffers[0], matchingBuffers[0]] });
        }

        return matchingBuffers;
    }, [tableFields, selectedTensor, userSelectedRows]);

    return tableFields ? (
        <HotkeysProvider>
            <div className='buffer-summary-table'>
                <div className='aside-container'>
                    <Checkbox
                        checked={mergedByDevice}
                        onChange={() => setMergedByDevice(!mergedByDevice)}
                    >
                        Merge buffers across devices
                    </Checkbox>
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
                        {tableFields.length !== listOfBuffers.length
                            ? `Showing ${tableFields.length} of ${listOfBuffers.length} buffers`
                            : `Showing ${tableFields.length} buffers`}
                    </p>
                </div>

                <BlueprintTable
                    numRows={tableFields.length}
                    enableRowResizing={false}
                    cellRendererDependencies={[sortDirection, sortingColumn, tableFields, tableFields.length]}
                    columnWidths={[200, 120, 120, 140, 120, 120, 100]}
                    ref={tableRef}
                    getCellClipboardData={(row, col) => getCellText(tableFields[row], COLUMNS[col].key)}
                >
                    {createColumns()}
                </BlueprintTable>
            </div>
        </HotkeysProvider>
    ) : (
        <LoadingSpinner />
    );
}

const getCellText = (buffer: SummaryTableBuffer, key: COLUMN_KEYS) => {
    let textValue = buffer[key]?.toString() || '';

    if (key === 'tensor_id') {
        textValue = buffer?.tensor_id ? `Tensor ${buffer.tensor_id}` : '';
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
    (
        key: COLUMN_KEYS,
        tableFields: SummaryTableBuffer[],
        filters: Record<COLUMN_KEYS, string>,
        selectedRows: number[],
    ) =>
    (rowIndex: number) => (
        <Cell className={classNames({ 'row-is-active': selectedRows.includes(rowIndex) })}>
            {getCellContent(key, rowIndex, tableFields, filters)}
        </Cell>
    );

const getCellContent = (
    key: COLUMN_KEYS,
    rowIndex: number,
    tableFields: SummaryTableBuffer[],
    filters: Record<COLUMN_KEYS, string>,
) => {
    const buffer = tableFields[rowIndex] as SummaryTableBuffer;
    const textValue = getCellText(buffer, key);

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

    return COLUMNS.find((column) => column.key === key)?.filterable ? (
        <HighlightedText
            text={textValue}
            filter={filters[key]}
        />
    ) : (
        textValue
    );
};

function areFiltersActive(filters: Record<COLUMN_KEYS, string>) {
    return Object.values(filters).some((filter) => filter.length > 0);
}

export default BufferSummaryTable;
