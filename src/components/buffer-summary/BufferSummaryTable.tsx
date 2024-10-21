import { HotkeysProvider } from '@blueprintjs/core';
import { Table2 as BlueprintTable, Cell, Column } from '@blueprintjs/table';
import { BufferTypeLabel } from '../../model/BufferType';
import LoadingSpinner from '../LoadingSpinner';
import '@blueprintjs/table/lib/css/table.css';
import 'styles/components/BufferSummaryTable.scss';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { HistoricalTensorsByOperation } from '../../model/BufferSummary';
import { toHex } from '../../functions/math';
import { getBufferColor, getTensorColor } from '../../functions/colorGenerator';

const COLUMNS = {
    operationId: 'Operation',
    tensor_id: 'Tensor Id',
    address: 'Address',
    size: 'Size',
    buffer_type: 'Buffer Type',
    device_id: 'Device Id',
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
        const columns = Object.entries(COLUMNS) as [keyof typeof COLUMNS, string][];

        return columns.map(([key, label]) => createColumn(key, label));
    };

    const createColumn = (key: keyof typeof COLUMNS, label: string) => {
        return (
            <Column
                key={key}
                name={label}
                cellRenderer={createCell(key)}
            />
        );
    };

    // eslint-disable-next-line react/no-unstable-nested-components
    const createCell = (key: keyof typeof COLUMNS) => (rowIndex: number) => {
        const cellContent = getCellContent(key, rowIndex);

        return <Cell>{cellContent}</Cell>;
    };

    const getCellContent = (key: keyof typeof COLUMNS, rowIndex: number) => {
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

    return buffersByOperation ? (
        <HotkeysProvider>
            <BlueprintTable
                className='buffer-summary-table'
                numRows={listOfBuffers.length}
                enableRowResizing={false}
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
