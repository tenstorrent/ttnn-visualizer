// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { AnchorButton, ButtonGroup, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BuffersByOperationData, useBuffers, useOperationsList } from '../hooks/useAPI';
import 'styles/components/BufferSummary.scss';
import BufferSummaryPlotRenderer from '../components/buffer-summary/BufferSummaryPlotRenderer';
import BufferSummaryTable from '../components/buffer-summary/BufferSummaryTable';
import ROUTES from '../definitions/routes';
import { BufferType } from '../model/BufferType';
import LoadingSpinner from '../components/LoadingSpinner';
import { HistoricalTensorsByOperation } from '../model/BufferSummary';
import useBufferFocus from '../hooks/useBufferFocus';
import { Operation, Tensor } from '../model/APIData';

const SECTION_IDS = {
    PLOT: 'plot',
    TABLE: 'table',
};

function BufferSummary() {
    const plotRef = useRef<HTMLHeadingElement>(null);
    const tableRef = useRef<HTMLHeadingElement>(null);
    const [activeSection, setActiveSection] = useState(SECTION_IDS.PLOT);
    const { data: buffersByOperation } = useBuffers(BufferType.L1);
    const { data: operationsList } = useOperationsList();

    const { activeToast, resetToasts } = useBufferFocus();

    useEffect(() => {
        const scrollRefs = [plotRef, tableRef];

        function navHighlighter() {
            const { scrollY } = window;

            scrollRefs.forEach((ref) => {
                if (ref?.current?.offsetHeight && ref?.current?.offsetTop) {
                    const sectionHeight = ref.current.offsetHeight;
                    const sectionTop = ref.current.offsetTop - 250;
                    const sectionId = ref.current.getAttribute('id');

                    if (sectionId && scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                        setActiveSection(sectionId);
                    }
                }
            });
        }

        window.addEventListener('scroll', navHighlighter);
        return () => window.removeEventListener('scroll', navHighlighter);
    }, []);

    const tensorListByOperation = useMemo(
        () => createHistoricalTensorList(operationsList, buffersByOperation),
        [operationsList, buffersByOperation],
    );

    return (
        <div className='buffer-summary'>
            <Helmet title='Buffer summary' />

            <h1 className='page-title'>L1 buffers by operation</h1>

            <ButtonGroup className='sticky-nav'>
                <AnchorButton
                    intent={Intent.PRIMARY}
                    href={`${ROUTES.BUFFERS}#${SECTION_IDS.PLOT}`}
                    icon={IconNames.HORIZONTAL_BAR_CHART}
                    outlined={activeSection !== SECTION_IDS.PLOT}
                >
                    Plot view
                </AnchorButton>

                <AnchorButton
                    intent={Intent.PRIMARY}
                    href={`${ROUTES.BUFFERS}#${SECTION_IDS.TABLE}`}
                    icon={IconNames.TH}
                    outlined={activeSection !== SECTION_IDS.TABLE}
                >
                    Table view
                </AnchorButton>
            </ButtonGroup>

            {activeToast && (
                // eslint-disable-next-line jsx-a11y/click-events-have-key-events,jsx-a11y/no-static-element-interactions
                <div
                    className='outside-click'
                    onClick={resetToasts}
                />
            )}

            {buffersByOperation && operationsList && tensorListByOperation ? (
                <>
                    <h2>Plot view</h2>
                    <div
                        ref={plotRef}
                        id={SECTION_IDS.PLOT}
                    >
                        <BufferSummaryPlotRenderer
                            buffersByOperation={buffersByOperation}
                            tensorListByOperation={tensorListByOperation}
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
            ) : (
                <LoadingSpinner />
            )}
        </div>
    );
}

// Modified from 'createHistoricalTensorList' function in OperationDetails.ts
// TODO: Refactor to optimise historical tensor lookup
function createHistoricalTensorList(operations?: Operation[], buffersByOperation?: BuffersByOperationData[]) {
    const historicalTensorsByOperation: HistoricalTensorsByOperation = new Map();

    if (!operations || !buffersByOperation) {
        return historicalTensorsByOperation;
    }

    buffersByOperation.forEach((operation) => {
        const tensorsByBufferAddress: Map<number, Tensor> = new Map();
        const currentOperation = operations.find((op) => op.id === operation.id);

        for (const buffer of operation.buffers) {
            const bufferAddress = buffer.address;
            const bufferType = buffer.buffer_type;
            let tensor: Tensor | undefined;

            for (let i = operations.indexOf(currentOperation!); i >= 0; i--) {
                const op = operations[i];
                tensor = op.inputs.find((input) => input.address === bufferAddress);

                if (tensor !== undefined) {
                    break;
                }

                tensor = op.outputs.find((output) => output.address === bufferAddress);

                if (tensor !== undefined) {
                    break;
                }
            }

            if (tensor !== undefined) {
                const historicalTensor: Tensor = {
                    ...tensor,
                    buffer_type: bufferType,
                };
                tensorsByBufferAddress.set(bufferAddress, historicalTensor);
            }
        }

        historicalTensorsByOperation.set(operation.id, tensorsByBufferAddress);
    });

    return historicalTensorsByOperation;
}

export default BufferSummary;
