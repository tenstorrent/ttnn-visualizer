// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RefObject, useMemo } from 'react';
import BufferSummaryPlotRenderer from './BufferSummaryPlotRenderer';
import BufferSummaryTable from './BufferSummaryTable';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import { SECTION_IDS } from '../../definitions/BufferSummary';
import BufferSummaryPlotRendererDRAM from './BufferSummaryPlotRendererDRAM';
import { Buffer } from '../../model/APIData';

interface BufferSummaryTabProps {
    plotRef: RefObject<HTMLHeadingElement>;
    tableRef: RefObject<HTMLHeadingElement>;
    buffersByOperation: BuffersByOperationData[];
    tensorListByOperation: TensorsByOperationByAddress;
    isDram?: boolean;
}

function BufferSummaryTab({
    plotRef,
    tableRef,
    buffersByOperation,
    tensorListByOperation,
    isDram = false,
}: BufferSummaryTabProps) {
    const uniqueBuffersByOperationList = useMemo(() => {
        return buffersByOperation.map((operation) => {
            const uniqueBuffers: Map<number, Buffer> = new Map<number, Buffer>();
            operation.buffers.forEach((buffer) => {
                const { address, size } = buffer;
                if (address) {
                    const existingBuffer = uniqueBuffers.get(address);
                    if (!existingBuffer || size > existingBuffer.size) {
                        uniqueBuffers.set(address, buffer);
                    }
                }
            });
            return {
                ...operation,
                buffers: Array.from(uniqueBuffers.values()),
            };
        });
    }, [buffersByOperation]);

    return (
        <>
            <h2>Plot view</h2>
            <div
                ref={plotRef}
                id={SECTION_IDS.PLOT}
            >
                {isDram ? (
                    <BufferSummaryPlotRendererDRAM
                        uniqueBuffersByOperationList={uniqueBuffersByOperationList}
                        tensorListByOperation={tensorListByOperation}
                    />
                ) : (
                    <BufferSummaryPlotRenderer
                        uniqueBuffersByOperationList={uniqueBuffersByOperationList}
                        tensorListByOperation={tensorListByOperation}
                    />
                )}
            </div>

            <h2>Table view</h2>
            <div
                ref={tableRef}
                id={SECTION_IDS.TABLE}
            >
                <BufferSummaryTable
                    buffersByOperation={buffersByOperation.filter((op) => op.buffers.length > 0)}
                    tensorListByOperation={tensorListByOperation}
                />
            </div>
        </>
    );
}

export default BufferSummaryTab;
