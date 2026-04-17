// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RefObject, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { Callout, Intent } from '@blueprintjs/core';
import BufferSummaryPlotRenderer from './BufferSummaryPlotRenderer';
import BufferSummaryTable from './BufferSummaryTable';
import { SECTION_IDS, TAB_IDS } from '../../definitions/BufferSummary';
import BufferSummaryPlotRendererDRAM from './BufferSummaryPlotRendererDRAM';
import { Buffer } from '../../model/APIData';
import { activeProfilerReportAtom, selectedBufferSummaryTabAtom } from '../../store/app';
import { BufferType } from '../../model/BufferType';
import { useBuffers, useCreateTensorsByOperationByIdList } from '../../hooks/useAPI';
import LoadingSpinner from '../LoadingSpinner';

interface BufferSummaryTabProps {
    plotRef: RefObject<HTMLHeadingElement | null>;
    tableRef: RefObject<HTMLHeadingElement | null>;
}

function BufferSummaryTab({ plotRef, tableRef }: BufferSummaryTabProps) {
    const selectedTabId = useAtomValue(selectedBufferSummaryTabAtom);
    const activePerformanceReport = useAtomValue(activeProfilerReportAtom);
    const selectedBufferType = selectedTabId === TAB_IDS.L1 ? BufferType.L1 : BufferType.DRAM;

    const tensorListByOperation = useCreateTensorsByOperationByIdList(selectedBufferType);
    const { data: buffersByOperation, error: buffersError } = useBuffers(selectedBufferType, true);

    const uniqueBuffersByOperationList = useMemo(
        () =>
            buffersByOperation?.map((operation) => {
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

    if (buffersError) {
        return (
            <Callout
                intent={Intent.WARNING}
                title='Error loading buffer data'
                compact
            >
                <p>
                    {`We've been unable to load the ${selectedTabId === TAB_IDS.L1 ? 'L1' : 'DRAM'} buffer data for /${activePerformanceReport?.path}.`}
                    <br />
                    {buffersError.message}
                </p>
            </Callout>
        );
    }

    return buffersByOperation && uniqueBuffersByOperationList && tensorListByOperation ? (
        <>
            <h2>Plot view</h2>
            <div
                ref={plotRef}
                id={SECTION_IDS.PLOT}
            >
                {selectedTabId === TAB_IDS.DRAM ? (
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
    ) : (
        <LoadingSpinner />
    );
}

export default BufferSummaryTab;
