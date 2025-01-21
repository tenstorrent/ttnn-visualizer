// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { RefObject } from 'react';
import BufferSummaryPlotRenderer from './BufferSummaryPlotRenderer';
import BufferSummaryTable from './BufferSummaryTable';
import { BuffersByOperationData } from '../../hooks/useAPI';
import { TensorsByOperationByAddress } from '../../model/BufferSummary';
import { SECTION_IDS } from '../../definitions/BufferSummary';

interface BufferSummaryTabProps {
    plotRef: RefObject<HTMLHeadingElement>;
    tableRef: RefObject<HTMLHeadingElement>;
    buffersByOperation: BuffersByOperationData[];
    tensorListByOperation: TensorsByOperationByAddress;
    isDramActive: boolean;
}

function BufferSummaryTab({
    plotRef,
    tableRef,
    buffersByOperation,
    tensorListByOperation,
    isDramActive,
}: BufferSummaryTabProps) {
    return (
        <>
            <h2>Plot view</h2>
            <div
                ref={plotRef}
                id={SECTION_IDS.PLOT}
            >
                <BufferSummaryPlotRenderer
                    buffersByOperation={buffersByOperation}
                    tensorListByOperation={tensorListByOperation}
                    isDramActive={isDramActive}
                />
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
