// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import 'styles/components/BufferSummaryPlot.scss';
import BufferSummaryPlotRenderer from '../components/buffer-summary/BufferSummaryPlotRenderer';
import BufferSummaryTable from '../components/buffer-summary/BufferSummaryTable';

export default function BufferSummary() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

    return (
        <>
            <Helmet title='Buffer summary' />

            <BufferSummaryPlotRenderer />

            <BufferSummaryTable />
        </>
    );
}
