import { HotkeysProvider, Icon } from '@blueprintjs/core';
import { Table2 as BlueprintTable, Cell, Column, ColumnHeaderCell } from '@blueprintjs/table';
import { IconNames } from '@blueprintjs/icons';
import { useBuffers } from '../../hooks/useAPI';
import { BufferType, BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import useOperationsTable from '../../hooks/useOperationsTable';

const HEADING_LABELS = ['Operation Id', 'Operation Name', 'Address', 'Size', 'Buffer Type', 'Device Id'];
const HEADINGS = {
    0: 'operationId',
    1: 'operationName',
    2: 'address',
    3: 'size',
    4: 'buffer_type',
    5: 'device_id',
};

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

function BufferSummaryTable() {
    const { data: buffersByOperation, isLoading: isLoadingBuffers } = useBuffers(BufferType.L1);
    const { changeSorting, sortingColumn, sortDirection } = useOperationsTable();

    let listOfBuffers: Buffer[] = [];

    if (buffersByOperation) {
        listOfBuffers = buffersByOperation
            .map((operation) =>
                operation.buffers
                    .map((buffer) => ({
                        ...buffer,
                        operationId: operation.id,
                        operationName: operation.name,
                    }))
                    .flat(),
            )
            .flat() as Buffer[];
    }

    const createColumns = () => {
        return HEADING_LABELS.map((heading, index) => createColumn(heading, index));
    };

    const createColumn = (heading: string, colIndex: number) => {
        return (
            <Column
                name={heading}
                key={heading}
                cellRenderer={createCell(colIndex as keyof typeof HEADINGS)}
                columnHeaderCellRenderer={
                    () => createCellHeader(colIndex)
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

    const createCellHeader = (colIndex: number) => {
        const columnLabel = HEADING_LABELS[colIndex];
        const column = HEADINGS[colIndex] as keyof Buffer;

        let targetSortDirection = sortDirection;

        const definition = { sortable: true };

        if (sortingColumn === column) {
            targetSortDirection = sortDirection === SortingDirection.ASC ? SortingDirection.DESC : SortingDirection.ASC;
        }

        return (
            <ColumnHeaderCell
                // className={`${definition?.sortable ? sortClass : ''} ${selectableClass}`}
                name={columnLabel}
            >
                <>
                    {definition?.sortable && (
                        <>
                            {}
                            <button
                                type='button'
                                className='sortable-table-header'
                                onClick={() => changeSorting(column)(targetSortDirection)}
                                title={columnLabel}
                            >
                                {sortingColumn === column && (
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
    const createCell = (colIndex: keyof typeof HEADINGS) => (rowIndex: number) => {
        const cellContent = getCellContent(colIndex, rowIndex);

        return <Cell>{cellContent}</Cell>;
    };

    const getCellContent = (colIndex: keyof typeof HEADINGS, rowIndex: number) => {
        const cellBuffer = listOfBuffers[rowIndex];
        const cellHeading = HEADINGS[colIndex] as keyof Buffer;

        if (cellHeading === 'buffer_type') {
            return BufferTypeLabel[cellBuffer.buffer_type];
        }

        return cellBuffer[cellHeading];
    };

    return !isLoadingBuffers && buffersByOperation ? (
        <HotkeysProvider>
            <BlueprintTable
                className='buffer-summary-table'
                numRows={listOfBuffers.length}
                enableRowResizing={false}
            >
                {createColumns()}
            </BlueprintTable>
        </HotkeysProvider>
    ) : (
        <LoadingSpinner />
    );
}

export default BufferSummaryTable;
