// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { HotkeysProvider, Icon } from '@blueprintjs/core';
import { Table2 as BlueprintTable, Cell, Column, ColumnHeaderCell } from '@blueprintjs/table';
import { IconNames } from '@blueprintjs/icons';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import SearchField from '../SearchField';
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
    searchable?: boolean;
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
        searchable: true,
    },
    {
        name: COLUMN_HEADERS.tensor_id,
        key: 'tensor_id',
        sortable: true,
        searchable: true,
    },
    {
        name: COLUMN_HEADERS.address,
        key: 'address',
        sortable: true,
        searchable: true,
    },
    {
        name: COLUMN_HEADERS.size,
        key: 'size',
        sortable: true,
        searchable: true,
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
}

function BufferSummaryTable({ buffersByOperation, tensorListByOperation }: BufferSummaryTableProps) {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useBuffersTable();
    const [filterQuery, setFilterQuery] = useState('');

    const listOfBuffers = useMemo(
        () =>
            buffersByOperation
                ?.map((operation) =>
                    operation.buffers
                        .map((buffer) => ({
                            ...buffer,
                            operation_id: operation.id,
                            operation_name: operation.name,
                        }))
                        .flat(),
                )
                .flat() as SummaryTableBuffer[],
        [buffersByOperation],
    );

    const createColumns = () => {
        return COLUMNS.map((column) => createColumn(column.key, column.name));
    };

    const createColumn = (key: COLUMN_KEYS, label: string) => (
        <Column
            key={key}
            name={label}
            cellRenderer={createCell(key, tableFields, filterQuery)}
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
            </ColumnHeaderCell>
        );
    };

    const tableFields = useMemo(() => {
        let filteredTableFields = listOfBuffers;

        if (filterQuery) {
            filteredTableFields = listOfBuffers.filter((buffer) =>
                buffer.operation_name.toLowerCase().includes(filterQuery.toLowerCase()),
            );
        }

        const buffers = filteredTableFields.map((buffer) => ({
            ...buffer,
            tensor_id: tensorListByOperation.get(buffer.operation_id)?.get(buffer.address)?.id,
        })) as [];

        return [...sortTableFields(buffers)];
    }, [listOfBuffers, sortTableFields, tensorListByOperation, filterQuery]);

    return tableFields ? (
        <>
            <SearchField
                className='buffer-summary-filter'
                placeholder='Search'
                searchQuery={filterQuery}
                onQueryChanged={(value) => setFilterQuery(value)}
            />

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
        </>
    ) : (
        <LoadingSpinner />
    );
}

const createCell = (key: COLUMN_KEYS, tableFields: SummaryTableBuffer[], filterQuery: string) => (rowIndex: number) => (
    <Cell>{getCellContent(key, rowIndex, tableFields, filterQuery)}</Cell>
);

const getCellContent = (key: COLUMN_KEYS, rowIndex: number, tableFields: SummaryTableBuffer[], filterQuery: string) => {
    const buffer = tableFields[rowIndex] as SummaryTableBuffer;

    if (key === 'operation_id') {
        return (
            <HighlightedText
                text={`${buffer.operation_id} - ${buffer.operation_name}`}
                filter={filterQuery}
            />
        );
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
                    text={buffer?.tensor_id ? `Tensor ${buffer.tensor_id}` : ''}
                    filter={filterQuery}
                />
            </div>
        );
    }

    if (key === 'buffer_type') {
        return BufferTypeLabel[buffer.buffer_type];
    }

    if (key === 'address') {
        return (
            <HighlightedText
                text={toHex(buffer.address)}
                filter={filterQuery}
            />
        );
    }

    return COLUMNS.find((column) => column.key === key)?.searchable ? (
        <HighlightedText
            text={buffer[key].toString()}
            filter={filterQuery}
        />
    ) : (
        buffer[key]
    );
};

export default BufferSummaryTable;
