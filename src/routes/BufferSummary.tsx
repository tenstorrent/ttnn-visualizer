// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { Size, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import useBufferFocusDismissal from '../hooks/useBufferFocusDismissal';
import BufferSummaryTab from '../components/buffer-summary/BufferSummaryTab';
import 'styles/components/BufferSummary.scss';
import { TAB_IDS } from '../definitions/BufferSummary';
import { selectedBufferSummaryTabAtom } from '../store/app';
import L1PeakComposition from '../components/buffer-summary/L1PeakComposition';
import BufferSummaryNavigation from '../components/buffer-summary/BufferSummaryNavigation';

function BufferSummary() {
    useBufferFocusDismissal();

    const [selectedTabId, setSelectedTabId] = useAtom(selectedBufferSummaryTabAtom);

    return (
        <div className='buffer-summary data-padding'>
            <Helmet title='Buffer summary' />

            <h1 className='page-title'>Buffers by operation</h1>

            {/* Plot and Table are sections of the buffer-type panels; the peak composition
                renders neither, so on that tab both anchors scroll to nothing. */}
            {selectedTabId !== TAB_IDS.PEAK && <BufferSummaryNavigation />}

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
                    panel={<BufferSummaryTab />}
                />

                <Tab
                    id={TAB_IDS.PEAK}
                    title='Peak composition'
                    icon={IconNames.TIMELINE_AREA_CHART}
                    panel={<L1PeakComposition />}
                />

                <Tab
                    id={TAB_IDS.DRAM}
                    title='DRAM'
                    icon={IconNames.PAGE_LAYOUT}
                    panel={<BufferSummaryTab />}
                />
            </Tabs>
        </div>
    );
}

export default BufferSummary;
