// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AnchorButton, ButtonGroup, Intent, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import { BuffersByOperationData, useBuffers, useOperationsList } from '../hooks/useAPI';
import useBufferFocus from '../hooks/useBufferFocus';
import { BufferType } from '../model/BufferType';
import { TensorsByOperationByAddress } from '../model/BufferSummary';
import { Operation, Tensor } from '../model/APIData';
import ROUTES from '../definitions/Routes';
import BufferSummaryTab from '../components/buffer-summary/BufferSummaryTab';
import LoadingSpinner from '../components/LoadingSpinner';
import 'styles/components/BufferSummary.scss';
import { SECTION_IDS, TAB_IDS } from '../definitions/BufferSummary';
import { selectedBufferSummaryTabAtom } from '../store/app';

function BufferSummary() {
    const plotRef = useRef<HTMLHeadingElement>(null);
    const tableRef = useRef<HTMLHeadingElement>(null);
    const [activeSection, setActiveSection] = useState<SECTION_IDS>(SECTION_IDS.PLOT);
    const [selectedTabId, setSelectedTabId] = useAtom(selectedBufferSummaryTabAtom);
    const { data: buffersByOperation } = useBuffers(BufferType.L1, true);
    const { data: dramBuffersByOperation } = useBuffers(BufferType.DRAM, true);
    const { data: operationsList } = useOperationsList();

    const { activeToast, resetToasts } = useBufferFocus();

    const isDramActive = selectedTabId === TAB_IDS.DRAM;

    useEffect(() => {
        const scrollRefs = [plotRef, tableRef];

        function navHighlighter() {
            const { scrollY } = window;

            scrollRefs.forEach((ref) => {
                if (ref?.current?.offsetHeight && ref?.current?.offsetTop) {
                    const sectionHeight = ref.current.offsetHeight;
                    const sectionTop = ref.current.offsetTop - 250;
                    const sectionId = ref.current.getAttribute('id') as SECTION_IDS | null;

                    if (sectionId && scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
                        setActiveSection(sectionId);
                    }
                }
            });
        }

        window.addEventListener('scroll', navHighlighter);
        return () => window.removeEventListener('scroll', navHighlighter);
    }, []);

    const tensorListByOperation = createTensorsByOperationByIdList(
        operationsList,
        isDramActive ? dramBuffersByOperation : buffersByOperation,
    );

    return (
        <div className='buffer-summary data-padding'>
            <Helmet title='Buffer summary' />

            <h1 className='page-title'>Buffers by operation</h1>

            <ButtonGroup className='sticky-nav'>
                <AnchorButton
                    intent={Intent.PRIMARY}
                    href={`${ROUTES.BUFFERS}#${SECTION_IDS.PLOT}`}
                    icon={IconNames.HORIZONTAL_BAR_CHART}
                    variant={activeSection !== SECTION_IDS.PLOT ? 'outlined' : undefined}
                >
                    Plot view
                </AnchorButton>

                <AnchorButton
                    intent={Intent.PRIMARY}
                    href={`${ROUTES.BUFFERS}#${SECTION_IDS.TABLE}`}
                    icon={IconNames.TH}
                    variant={activeSection !== SECTION_IDS.TABLE ? 'outlined' : undefined}
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

            <Tabs
                id='performance-tabs'
                selectedTabId={selectedTabId}
                onChange={(id: TAB_IDS) => setSelectedTabId(id)}
                size='large'
                renderActiveTabPanelOnly
            >
                <Tab
                    id={TAB_IDS.L1}
                    title='L1'
                    icon={IconNames.PAGE_LAYOUT}
                    panel={
                        buffersByOperation && operationsList && tensorListByOperation ? (
                            <BufferSummaryTab
                                plotRef={plotRef}
                                tableRef={tableRef}
                                buffersByOperation={buffersByOperation}
                                tensorListByOperation={tensorListByOperation}
                            />
                        ) : (
                            <LoadingSpinner />
                        )
                    }
                />

                <Tab
                    id={TAB_IDS.DRAM}
                    title='DRAM'
                    icon={IconNames.PAGE_LAYOUT}
                    panel={
                        dramBuffersByOperation && operationsList && tensorListByOperation ? (
                            <BufferSummaryTab
                                plotRef={plotRef}
                                tableRef={tableRef}
                                buffersByOperation={dramBuffersByOperation}
                                tensorListByOperation={tensorListByOperation}
                                isDram
                            />
                        ) : (
                            <LoadingSpinner />
                        )
                    }
                />
            </Tabs>
        </div>
    );
}

// TODO: Refactor to optimise historical tensor lookup
function createTensorsByOperationByIdList(operations?: Operation[], buffersByOperation?: BuffersByOperationData[]) {
    const tensorsByOperationByAddress: TensorsByOperationByAddress = new Map();

    if (!operations || !buffersByOperation) {
        return tensorsByOperationByAddress;
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
                tensorsByBufferAddress.set(bufferAddress, {
                    ...tensor,
                    buffer_type: bufferType,
                });
            }
        }

        tensorsByOperationByAddress.set(operation.id, tensorsByBufferAddress);
    });

    return tensorsByOperationByAddress;
}

export default BufferSummary;
