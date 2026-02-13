// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { AnchorButton, ButtonGroup, ButtonVariant, Callout, Intent, Size, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom, useAtomValue } from 'jotai';
import { useBuffers, useCreateTensorsByOperationByIdList, useOperationsList } from '../hooks/useAPI';
import useBufferFocus from '../hooks/useBufferFocus';
import { BufferType } from '../model/BufferType';
import ROUTES from '../definitions/Routes';
import BufferSummaryTab from '../components/buffer-summary/BufferSummaryTab';
import LoadingSpinner from '../components/LoadingSpinner';
import 'styles/components/BufferSummary.scss';
import { SECTION_IDS, TAB_IDS } from '../definitions/BufferSummary';
import { activeProfilerReportAtom, selectedBufferSummaryTabAtom } from '../store/app';

function BufferSummary() {
    const plotRef = useRef<HTMLHeadingElement>(null);
    const tableRef = useRef<HTMLHeadingElement>(null);
    const [activeSection, setActiveSection] = useState<SECTION_IDS>(SECTION_IDS.PLOT);
    const [selectedTabId, setSelectedTabId] = useAtom(selectedBufferSummaryTabAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    // TODO: this requires further optimization
    const { data: buffersByOperation, error: buffersError } = useBuffers(
        selectedTabId === TAB_IDS.L1 ? BufferType.L1 : BufferType.DRAM,
        true,
    );
    const { data: operationsList } = useOperationsList();
    const { activeToast, resetToasts } = useBufferFocus();

    const tensorListByOperation = useCreateTensorsByOperationByIdList(
        selectedTabId === TAB_IDS.L1 ? BufferType.L1 : BufferType.DRAM,
    );

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

    return (
        <div className='buffer-summary data-padding'>
            <Helmet title='Buffer summary' />

            <h1 className='page-title'>Buffers by operation</h1>

            <ButtonGroup className='sticky-nav'>
                <AnchorButton
                    intent={Intent.PRIMARY}
                    href={`${ROUTES.BUFFERS}#${SECTION_IDS.PLOT}`}
                    icon={IconNames.HORIZONTAL_BAR_CHART}
                    variant={activeSection !== SECTION_IDS.PLOT ? ButtonVariant.OUTLINED : undefined}
                >
                    Plot view
                </AnchorButton>

                <AnchorButton
                    intent={Intent.PRIMARY}
                    href={`${ROUTES.BUFFERS}#${SECTION_IDS.TABLE}`}
                    icon={IconNames.TH}
                    variant={activeSection !== SECTION_IDS.TABLE ? ButtonVariant.OUTLINED : undefined}
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
                size={Size.LARGE}
                renderActiveTabPanelOnly
            >
                <Tab
                    id={TAB_IDS.L1}
                    title='L1'
                    icon={IconNames.PAGE_LAYOUT}
                    panel={
                        // TODO: excessive prop passing
                        // eslint-disable-next-line no-nested-ternary
                        buffersByOperation && operationsList && tensorListByOperation ? (
                            <BufferSummaryTab
                                plotRef={plotRef}
                                tableRef={tableRef}
                                buffersByOperation={buffersByOperation}
                                tensorListByOperation={tensorListByOperation}
                            />
                        ) : buffersError ? (
                            <Callout
                                intent={Intent.WARNING}
                                title='Error loading buffer data'
                                compact
                            >
                                <p>
                                    {`We've been unable to load the L1 buffer data for /${activeProfilerReport?.path}.`}
                                    <br />
                                    {buffersError.message}
                                </p>
                            </Callout>
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
                        // TODO: excessive prop passing
                        // eslint-disable-next-line no-nested-ternary
                        buffersByOperation && operationsList && tensorListByOperation ? (
                            <BufferSummaryTab
                                plotRef={plotRef}
                                tableRef={tableRef}
                                buffersByOperation={buffersByOperation}
                                tensorListByOperation={tensorListByOperation}
                                isDram
                            />
                        ) : buffersError ? (
                            <Callout
                                intent={Intent.WARNING}
                                title='Error loading buffer data'
                                compact
                            >
                                <p>
                                    {`We've been unable to load the DRAM buffer data for /${activeProfilerReport?.path}.`}
                                    <br />
                                    {buffersError.message}
                                </p>
                            </Callout>
                        ) : (
                            <LoadingSpinner />
                        )
                    }
                />
            </Tabs>
        </div>
    );
}

export default BufferSummary;
