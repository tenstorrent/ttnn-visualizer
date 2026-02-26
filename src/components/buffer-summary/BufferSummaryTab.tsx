// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RefObject, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import BufferSummaryPlotRenderer from './BufferSummaryPlotRenderer';
import BufferSummaryTable from './BufferSummaryTable';
import { SECTION_IDS, TAB_IDS } from '../../definitions/BufferSummary';
import BufferSummaryPlotRendererDRAM from './BufferSummaryPlotRendererDRAM';
import { Buffer, BuffersByOperation } from '../../model/APIData';
import { selectedBufferSummaryTabAtom } from '../../store/app';

interface BufferSummaryTabProps {
    plotRef: RefObject<HTMLHeadingElement>;
    tableRef: RefObject<HTMLHeadingElement>;
    buffersByOperation: BuffersByOperation[];
}

function BufferSummaryTab({ plotRef, tableRef, buffersByOperation }: BufferSummaryTabProps) {
    const selectedTabId = useAtomValue(selectedBufferSummaryTabAtom);

    const uniqueBuffersByOperationList = useMemo(
        () =>
            buffersByOperation.map((operation) => {
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
            }),
        [buffersByOperation],
    );

    return (
        <>
            <h2>Plot view</h2>
            <div
                ref={plotRef}
                id={SECTION_IDS.PLOT}
            >
                {selectedTabId === TAB_IDS.DRAM ? (
                    <BufferSummaryPlotRendererDRAM uniqueBuffersByOperationList={uniqueBuffersByOperationList} />
                ) : (
                    <BufferSummaryPlotRenderer uniqueBuffersByOperationList={uniqueBuffersByOperationList} />
                )}
            </div>

            <h2>Table view</h2>
            <div
                ref={tableRef}
                id={SECTION_IDS.TABLE}
            >
                <BufferSummaryTable buffersByOperation={buffersByOperation.filter((op) => op.buffers.length > 0)} />
            </div>
        </>
    );
}

export default BufferSummaryTab;
