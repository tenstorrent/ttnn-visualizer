import { HotkeysProvider } from '@blueprintjs/core';
import { Table2 as BlueprintTable, Cell, Column } from '@blueprintjs/table';
import { BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { HistoricalTensorsByOperation } from '../../model/BufferSummary';

const HEADING_LABELS = ['Operation', 'Address', 'Size', 'Buffer Type', 'Device Id'];
const HEADINGS = {
    0: 'operationId',
    1: 'address',
    2: 'size',
    3: 'buffer_type',
    4: 'device_id',
};

interface BufferSummaryTableProps {
    buffersByOperation: BuffersByOperationData[];
    tensorListByOperation: HistoricalTensorsByOperation;
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
            />
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

        if (cellHeading === 'operationId') {
            const tensor = tensorListByOperation.get(cellBuffer.operationId)?.get(cellBuffer.address);

            return (
                <div className='operation-cell'>
                    <div
                        className='memory-color-block'
                        style={{
                            backgroundColor: tensor ? getTensorColor(tensor.id) : getBufferColor(cellBuffer.address),
                        }}
                    />
                    <span>{cellBuffer.operationId}</span>
                    <span>{cellBuffer.operationName}</span>
                </div>
            );
        }

        if (cellHeading === 'buffer_type') {
            return BufferTypeLabel[cellBuffer.buffer_type];
        }

        return cellBuffer[cellHeading];
    };

    return buffersByOperation ? (
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
