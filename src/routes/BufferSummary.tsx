// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { AnchorButton, ButtonGroup, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useSetAtom } from 'jotai';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { BuffersByOperationData, useBuffers, useOperationsList, useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import 'styles/components/BufferSummary.scss';
import BufferSummaryPlotRenderer from '../components/buffer-summary/BufferSummaryPlotRenderer';
import BufferSummaryTable from '../components/buffer-summary/BufferSummaryTable';
import ROUTES from '../definitions/routes';
import { BufferType } from '../model/BufferType';
import LoadingSpinner from '../components/LoadingSpinner';
import { HistoricalTensor, Operation, Tensor } from '../model/Graph';
import { HistoricalTensorsByOperation } from '../model/BufferSummary';

const SECTION_IDS = {
    PLOT: 'plot',
    TABLE: 'table',
};

function BufferSummary() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);
    const plotRef = useRef<HTMLHeadingElement>(null);
    const tableRef = useRef<HTMLHeadingElement>(null);
    const deviceId = 0;
    const [activeSection, setActiveSection] = useState(SECTION_IDS.PLOT);
    const { data: buffersByOperation } = useBuffers(BufferType.L1, deviceId);
    const { data: operationsList } = useOperationsList();

    // Dismiss any toasts that are open
    useEffect(() => toast.dismiss(), []);

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

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
                            buffersByOperation={buffersByOperation}
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

// Modified from 'createHitoricalTensorList' function in OperationDetails.ts
// TODO: Refactor to optimise historical tensor lookup
function createHistoricalTensorList(operations?: Operation[], buffersByOperation?: BuffersByOperationData[]) {
    const historicalTensorsByOperation: HistoricalTensorsByOperation = new Map();

    if (!operations || !buffersByOperation) {
        return historicalTensorsByOperation;
    }

    buffersByOperation.forEach((operation) => {
        const tensorsByBufferAddress: Map<number, HistoricalTensor> = new Map();
        const currentOperation = operations.find((op) => op.id === operation.id);

        for (const buffer of operation.buffers) {
            const bufferAddress = buffer.address;
            const bufferType = buffer.buffer_type;
            let opId: number | undefined;
            let tensor: Tensor | undefined;

            for (let i = operations.indexOf(currentOperation!); i >= 0; i--) {
                const op = operations[i];
                opId = op.id;

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
                const historicalTensor: HistoricalTensor = {
                    ...tensor,
                    parentOperationId: opId!,
                    historical: opId! !== operation.id,
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
