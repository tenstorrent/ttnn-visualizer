// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { AnchorButton, ButtonGroup, ButtonVariant, Intent, Size, Tab, Tabs } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import useBufferFocus from '../hooks/useBufferFocus';
import { useActiveSection } from '../hooks/useActiveSection';
import ROUTES from '../definitions/Routes';
import BufferSummaryTab from '../components/buffer-summary/BufferSummaryTab';
import 'styles/components/BufferSummary.scss';
import { SECTION_IDS, TAB_IDS } from '../definitions/BufferSummary';
import { selectedBufferSummaryTabAtom } from '../store/app';

function BufferSummary() {
    const { activeToast, resetToasts } = useBufferFocus();

    const activeSection = useActiveSection([SECTION_IDS.PLOT, SECTION_IDS.TABLE]);
    const [selectedTabId, setSelectedTabId] = useAtom(selectedBufferSummaryTabAtom);

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
                    panel={<BufferSummaryTab />}
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
