// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { HotkeysProvider, Icon, InputGroup } from '@blueprintjs/core';
import { Table2 as BlueprintTable, Cell, Column, ColumnHeaderCell } from '@blueprintjs/table';
import { IconNames } from '@blueprintjs/icons';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import HighlightedText from '../HighlightedText';
import useBuffersTable, { SortingDirection } from '../../hooks/useBuffersTable';
import { HistoricalTensorsByOperation } from '../../model/BufferSummary';
import { toHex } from '../../functions/math';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { BufferData } from '../../model/APIData';

interface ColumnDefinition {
    name: string;
    key: COLUMN_KEYS;
    sortable?: boolean;
    filterable?: boolean;
}

enum COLUMN_HEADERS {
    operation_id = 'Operation',
    tensor_id = 'Tensor Id',
    address = 'Address',
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
    tensorListByOperation: HistoricalTensorsByOperation;
}

interface SummaryTableBuffer extends BufferData {
    size: number;
    operation_name: string;
    tensor_id: number;
    hexAddress: string;
}

function BufferSummaryTable({ buffersByOperation, tensorListByOperation }: BufferSummaryTableProps) {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useBuffersTable();
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

    const listOfBuffers = useMemo(
        () =>
            buffersByOperation
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
                .flat(),
        [buffersByOperation, tensorListByOperation],
    );

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
            cellRenderer={createCell(key, tableFields, filters)}
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
                            small
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

        if (areFiltersActive(filters) && filterableColumnKeys) {
            filteredTableFields = listOfBuffers.filter((buffer) => {
                const isFilteredOut = Object.entries(filters)
                    .filter(([_key, filterValue]) => String(filterValue).length)
                    .some(([key, filterValue]) => {
                        let bufferValue = String(buffer[key as COLUMN_KEYS]);

                        if (key === 'operation_id') {
                            bufferValue = `${buffer.operation_id} - ${buffer.operation_name}`;
                        }

                        if (key === 'tensor_id' && buffer[key]) {
                            bufferValue = `Tensor ${buffer[key]}`;
                        }

                        if (key === 'address') {
                            bufferValue = buffer.hexAddress;
                        }

                        return !bufferValue.toLowerCase().includes(filterValue.toLowerCase());
                    });

                return !isFilteredOut;
            });
        }

        return [...sortTableFields(filteredTableFields as [])];
    }, [listOfBuffers, sortTableFields, filterableColumnKeys, filters]);

    return tableFields ? (
        <HotkeysProvider>
            <BlueprintTable
                className='buffer-summary-table'
                numRows={tableFields.length}
                enableRowResizing={false}
                cellRendererDependencies={[sortDirection, sortingColumn, tableFields, tableFields.length]}
                columnWidths={[200, 120, 120, 120, 120, 100]}
            >
                {createColumns()}
            </BlueprintTable>
        </HotkeysProvider>
    ) : (
        <LoadingSpinner />
    );
}

const createCell =
    (key: COLUMN_KEYS, tableFields: SummaryTableBuffer[], filters: Record<COLUMN_KEYS, string>) =>
    (rowIndex: number) => <Cell>{getCellContent(key, rowIndex, tableFields, filters)}</Cell>;

const getCellContent = (
    key: COLUMN_KEYS,
    rowIndex: number,
    tableFields: SummaryTableBuffer[],
    filters: Record<COLUMN_KEYS, string>,
) => {
    const buffer = tableFields[rowIndex] as SummaryTableBuffer;
    let textValue = buffer[key].toString();

    if (key === 'tensor_id') {
        textValue = buffer?.tensor_id ? `Tensor ${buffer.tensor_id}` : '';

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

    if (key === 'operation_id') {
        textValue = `${buffer.operation_id} - ${buffer.operation_name}`;
    }

    if (key === 'buffer_type') {
        textValue = BufferTypeLabel[buffer.buffer_type];
    }

    if (key === 'address') {
        textValue = buffer.hexAddress;
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
