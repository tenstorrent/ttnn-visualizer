// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import classNames from 'classnames';
import { useMemo, useState } from 'react';
import { HotkeysProvider, Icon } from '@blueprintjs/core';
import { useAtomValue } from 'jotai';
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
import { selectedTensorAtom } from '../../store/app';

interface ColumnDefinition {
    name: string;
    key: COLUMN_KEYS;
    sortable?: boolean;
}

enum COLUMN_HEADERS {
    operationId = 'Operation',
    tensor_id = 'Tensor Id',
    address = 'Address',
    size = 'Size',
    buffer_type = 'Buffer Type',
    device_id = 'Device Id',
}

type COLUMN_KEYS = keyof typeof COLUMN_HEADERS;

const COLUMNS: ColumnDefinition[] = [
    {
        name: COLUMN_HEADERS.operationId,
        key: 'operationId',
        sortable: true,
    },
    {
        name: COLUMN_HEADERS.tensor_id,
        key: 'tensor_id',
        sortable: true,
    },
    {
        name: COLUMN_HEADERS.address,
        key: 'address',
        sortable: true,
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
    operationName: string;
    tensor_id: number;
}

function BufferSummaryTable({ buffersByOperation, tensorListByOperation }: BufferSummaryTableProps) {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useBuffersTable();
    const [filterQuery, setFilterQuery] = useState('');
    const selectedTensor = useAtomValue(selectedTensorAtom);

    const listOfBuffers = useMemo(
        () =>
            buffersByOperation
                ?.map((operation) =>
                    operation.buffers
                        .map((buffer) => ({
                            ...buffer,
                            operation_id: operation.id,
                            operationName: operation.name,
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
                buffer.operationName.toLowerCase().includes(filterQuery.toLowerCase()),
            );
        }

        const buffers = filteredTableFields.map((buffer) => ({
            ...buffer,
            tensor_id: tensorListByOperation.get(buffer.operation_id)?.get(buffer.address)?.id,
        })) as [];

        return [...sortTableFields(buffers)] as SummaryTableBuffer[];
    }, [listOfBuffers, sortTableFields, tensorListByOperation, filterQuery]);

    const selectedRows = useMemo(() => {
        if (!selectedTensor) {
            return [];
        }

        const matchingBuffers = tableFields.reduce((arr: number[], buffer, index: number) => {
            if (buffer?.tensor_id === selectedTensor) {
                arr.push(index);
            }

            return arr;
        }, []);

        return matchingBuffers.map((index) => ({ rows: [index, index] }));
    }, [tableFields, selectedTensor]);

    return tableFields ? (
        <>
            <SearchField
                className='buffer-summary-filter'
                placeholder='Filter operations'
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
                    selectedRegions={selectedRows}
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

    if (key === 'operationId') {
        return (
            <HighlightedText
                text={`${buffer.operation_id} - ${buffer.operationName}`}
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
                <span>{buffer?.tensor_id ? `Tensor ${buffer.tensor_id}` : ''}</span>
            </div>
        );
    }

    if (key === 'buffer_type') {
        return BufferTypeLabel[buffer.buffer_type];
    }

    if (key === 'address') {
        return toHex(buffer.address);
    }

    return buffer[key];
};

export default BufferSummaryTable;
