// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import 'styles/components/BufferSummaryPlot.scss';
import BufferSummaryChart from '../components/BufferSummaryChart';

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

            <BufferSummaryChart />

            <table>
                <tbody>
                    <tr>
                        <th>BufferSummaryTable goes here</th>
                    </tr>
                </tbody>
            </table>
        </>
    );
}
