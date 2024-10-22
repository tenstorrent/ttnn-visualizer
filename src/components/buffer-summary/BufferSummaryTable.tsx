// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useMemo } from 'react';
import { HotkeysProvider, Icon } from '@blueprintjs/core';
import { Table2 as BlueprintTable, Cell, Column, ColumnHeaderCell } from '@blueprintjs/table';
import { IconNames } from '@blueprintjs/icons';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import useOperationsTable from '../../hooks/useOperationsTable';
import { HistoricalTensorsByOperation } from '../../model/BufferSummary';
import { toHex } from '../../functions/math';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';

enum COLUMNS {
    operationId = 'Operation',
    tensor_id = 'Tensor Id',
    address = 'Address',
    size = 'Size',
    buffer_type = 'Buffer Type',
    device_id = 'Device Id',
}

type COLUMN_KEYS = keyof typeof COLUMNS;

interface BufferSummaryTableProps {
    buffersByOperation: BuffersByOperationData[];
    tensorListByOperation: HistoricalTensorsByOperation;
}

enum SortingDirection {
    ASC = 'asc',
    DESC = 'desc',
}

interface Buffer {
    address: number;
    buffer_type: number;
    device_id: number;
    size: number;
    operationId: number;
    operationName: string;
    tensor_id: number;
}

function BufferSummaryTable({ buffersByOperation, tensorListByOperation }: BufferSummaryTableProps) {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useOperationsTable();

    const listOfBuffers = useMemo(
        () =>
            buffersByOperation
                ?.map((operation) =>
                    operation.buffers
                        .map((buffer) => ({
                            ...buffer,
                            operationId: operation.id,
                            operationName: operation.name,
                        }))
                        .flat(),
                )
                .flat() as Buffer[],
        [buffersByOperation],
    );

    const createColumns = () => {
        const columns = Object.entries(COLUMNS) as [COLUMN_KEYS, string][];

        return columns.map(([key, label]) => createColumn(key, label));
    };

    const createColumn = (key: COLUMN_KEYS, label: string) => (
        <Column
            key={key}
            name={label}
            cellRenderer={createCell(key, tableFields)}
            columnHeaderCellRenderer={() => createCellHeader(key, label)}
        />
    );

    const createCellHeader = (key: COLUMN_KEYS, label: string) => {
        let targetSortDirection = sortDirection;

        const definition = { sortable: true };

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
                        {sortingColumn === key && (
                            <span className='sort-icon'>
                                <Icon
                                    icon={
                                        sortDirection === SortingDirection.ASC
                                            ? IconNames.SORT_ASC
                                            : IconNames.SORT_DESC
                                    }
                                />
                            </span>
                        )}
                    </button>
                )}
            </ColumnHeaderCell>
        );
    };

    const tableFields = useMemo(() => {
        const buffers = listOfBuffers.map((buffer) => ({
            ...buffer,
            tensor_id: tensorListByOperation.get(buffer.operationId)?.get(buffer.address)?.id,
        })) as [];

        return [...sortTableFields(buffers)];
    }, [listOfBuffers, sortTableFields, tensorListByOperation]);

    return tableFields ? (
        <HotkeysProvider>
            <BlueprintTable
                className='buffer-summary-table'
                numRows={tableFields.length}
                enableRowResizing={false}
                cellRendererDependencies={[sortDirection, sortingColumn, tableFields, tableFields.length]}
                columnWidths={[200, 120, 150, 150, 100, 100]}
            >
                {createColumns()}
            </BlueprintTable>
        </HotkeysProvider>
    ) : (
        <LoadingSpinner />
    );
}

const createCell = (key: COLUMN_KEYS, tableFields: Buffer[]) => (rowIndex: number) => (
    <Cell>{getCellContent(key, rowIndex, tableFields)}</Cell>
);

const getCellContent = (key: COLUMN_KEYS, rowIndex: number, tableFields: Buffer[]) => {
    const buffer = tableFields[rowIndex] as Buffer;

    if (key === 'operationId') {
        return `${buffer.operationId} - ${buffer.operationName}`;
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
