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
}

function BufferSummaryTable({ buffersByOperation, tensorListByOperation }: BufferSummaryTableProps) {
    const { sortTableFields, changeSorting, sortingColumn, sortDirection } = useOperationsTable();

    const listOfBuffers: Buffer[] = useMemo(
        () =>
            (buffersByOperation
                ?.map((operation) =>
                    operation.buffers
                        .map((buffer) => ({
                            ...buffer,
                            operationId: operation.id,
                            operationName: operation.name,
                        }))
                        .flat(),
                )
                .flat() as Buffer[]) ?? [],
        [buffersByOperation],
    );

    const createColumns = () => {
        const columns = Object.entries(COLUMNS) as [COLUMN_KEYS, string][];

        return columns.map(([key, label]) => createColumn(key, label));
    };

    const createColumn = (key: COLUMN_KEYS, label: string) => {
        return (
            <Column
                key={key}
                name={label}
                cellRenderer={createCell(key)}
                columnHeaderCellRenderer={
                    () => createCellHeader(key, label)
                    // definition: columnDefinition.get(key),
                    // changeSorting,
                    // sortDirection,
                    // sortingColumn,
                    // tableFields,
                    // })
                }
            />
        );
    };

    const createCellHeader = (key: COLUMN_KEYS, label: string) => {
        let targetSortDirection = sortDirection;

        const definition = { sortable: true };

        if (sortingColumn === key) {
            targetSortDirection = sortDirection === SortingDirection.ASC ? SortingDirection.DESC : SortingDirection.ASC;
        }

        return (
            <ColumnHeaderCell
                // className={`${definition?.sortable ? sortClass : ''} ${selectableClass}`}
                name={label}
            >
                <>
                    {definition?.sortable && (
                        <>
                            {}
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
                        </>
                    )}
                    {/* {definition?.canSelectAllRows && (
                        <Checkbox
                            checked={checkboxState === 'checked'}
                            indeterminate={checkboxState === 'indeterminate'}
                            disabled={checkboxState === 'disabled'}
                            onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                definition.handleSelectAll?.(tableFields, e.target.checked)
                            }
                            className='sortable-table-checkbox'
                        />
                    )} */}
                </>
            </ColumnHeaderCell>
        );
    };

    // eslint-disable-next-line react/no-unstable-nested-components
    const createCell = (key: COLUMN_KEYS) => (rowIndex: number) => {
        const cellContent = getCellContent(key, rowIndex);

        return <Cell>{cellContent}</Cell>;
    };

    const tableFields = useMemo(() => {
        // const selectedOperationCores: ComputeNode[] = [];

        // for (const { graphOnChip } of graphOnChipList) {
        //     selectedOperationCores.push(...(graphOnChip.getOperation(selectedOperationName)?.cores ?? []));
        // }

        // if (selectedOperationCores.length > 0) {
        //     list = selectedOperationCores.map((core: ComputeNode) => {
        //         return {
        //             name: core.operation?.name,
        //             ...core.perfAnalyzerResults,
        //             core_id: core.uid,
        //             slowestOperandRef: core.operation?.slowestOperand,
        //             chipId: core.chipId,
        //         } as OpTableFields;
        //     });
        // } else {
        //     list = [
        //         ...graphOnChipList
        //             .reduce((opMap, { graphOnChip }) => {
        //                 [...graphOnChip.operations].forEach((op) => {
        //                     if (!opMap.has(op.name)) {
        //                         opMap.set(op.name, {
        //                             operation: op,
        //                             name: op.name,
        //                             ...op.details,
        //                             slowestOperandRef: op.slowestOperand,
        //                             chipId: graphOnChip.chipId,
        //                         } as unknown as OpTableFields);
        //                     }
        //                 });

        //                 return opMap;
        //             }, new Map<string, OpTableFields>())
        //             .values(),
        //     ];
        // }

        // if (filterQuery) {
        //     list = list.filter(({ operation }) => {
        //         return operation?.name.toLowerCase().includes(filterQuery.toLowerCase()) ?? true;
        //     });
        // }

        return [...sortTableFields(listOfBuffers)];
    }, [listOfBuffers, sortTableFields]);

    const getCellContent = (key: COLUMN_KEYS, rowIndex: number) => {
        const buffer = listOfBuffers[rowIndex];
        const tensor = tensorListByOperation.get(buffer.operationId)?.get(buffer.address);

        if (key === 'operationId') {
            return `${buffer.operationId} - ${buffer.operationName}`;
        }

        if (key === 'tensor_id') {
            return (
                <div className='operation-cell'>
                    <div
                        className='memory-color-block'
                        style={{
                            backgroundColor: tensor ? getTensorColor(tensor.id) : getBufferColor(buffer.address),
                        }}
                    >
                        {/* Ensures the memory color block takes up space when the table component recalculates the width of the column */}
                        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
                    </div>
                    <span>{tensor?.id ? `Tensor ${tensor.id}` : ''}</span>
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

    return tableFields ? (
        <HotkeysProvider>
            <BlueprintTable
                className='buffer-summary-table'
                numRows={tableFields.length}
                enableRowResizing={false}
                cellRendererDependencies={[sortDirection, sortingColumn, tableFields, tableFields.length]}
                columnWidths={[200, 100, 150, 150, 100, 100]}
            >
                {createColumns()}
            </BlueprintTable>
        </HotkeysProvider>
    ) : (
        <LoadingSpinner />
    );
}

export default BufferSummaryTable;
