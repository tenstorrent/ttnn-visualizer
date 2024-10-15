// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { AnchorButton, ButtonGroup, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useSetAtom } from 'jotai';
import { useEffect, useRef, useState } from 'react';
import { useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import 'styles/components/BufferSummary.scss';
import BufferSummaryPlotRenderer from '../components/buffer-summary/BufferSummaryPlotRenderer';
import BufferSummaryTable from '../components/buffer-summary/BufferSummaryTable';
import ROUTES from '../definitions/routes';

const SECTION_IDS = {
    PLOT: 'plot',
    TABLE: 'table',
};

export default function BufferSummary() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);
    const plotRef = useRef<HTMLHeadingElement>(null);
    const tableRef = useRef<HTMLHeadingElement>(null);
    const [activeSection, setActiveSection] = useState(SECTION_IDS.PLOT);

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

    return (
        <div className='buffer-summary'>
            <Helmet title='Buffer summary' />

            <h1 className='page-title'>All buffers by operation</h1>

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

            <h2>Plot view</h2>
            <div
                ref={plotRef}
                id={SECTION_IDS.PLOT}
            >
                <BufferSummaryPlotRenderer />
            </div>

            <h2>Table view</h2>
            <div
                ref={tableRef}
                id={SECTION_IDS.TABLE}
            >
                <BufferSummaryTable />
            </div>
        </div>
    );
}
