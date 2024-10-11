import { HotkeysProvider } from '@blueprintjs/core';
import { Table2 as BlueprintTable, Cell, Column } from '@blueprintjs/table';
import { useBuffers, useOperationsList } from '../../hooks/useAPI';
import { BufferType, BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';

const HEADING_LABELS = ['', 'Operation Id', 'Operation Name', 'Address', 'Size', 'Buffer Type', 'Device Id'];
const HEADINGS = {
    0: '',
    1: 'operationId',
    2: 'operationName',
    3: 'address',
    4: 'size',
    5: 'buffer_type',
    6: 'device_id',
};

interface Buffer {
    address: number;
    buffer_type: number;
    device_id: number;
    size: number;
    operationId: number;
    operationName: string;
}

function BufferSummaryTable() {
    const { data: operations } = useOperationsList();
    const { data: buffersByOperation, isLoading: isLoadingBuffers } = useBuffers(BufferType.L1);

    let listOfBuffers: Buffer[] = [];

    if (buffersByOperation && operations) {
        listOfBuffers = buffersByOperation
            .map((operation) =>
                operation.buffers
                    .map((buffer) => ({
                        ...buffer,
                        operationId: operation.id,
                        operationName: operations.find((op) => op.id === operation.id)?.name,
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
            />
        );
    };

    // eslint-disable-next-line react/no-unstable-nested-components
    const createCell = (colIndex: keyof typeof HEADINGS) => (rowIndex: number) => {
        const cellContent = getCellContent(colIndex, rowIndex);

        return <Cell>{cellContent}</Cell>;
    };

    const getCellContent = (colIndex: keyof typeof HEADINGS, rowIndex: number) => {
        if (HEADINGS[colIndex] === 'buffer_type') {
            return BufferTypeLabel[listOfBuffers[rowIndex][HEADINGS[colIndex]]];
        }

        return colIndex === 0 ? rowIndex + 1 : listOfBuffers[rowIndex][HEADINGS[colIndex]];
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
