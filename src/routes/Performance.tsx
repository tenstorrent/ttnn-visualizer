// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import file from '../../public/perf/profile_log_device.csv';

export default function Performance() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);

    const config = {};
    console.log(file);

    useClearSelectedBuffer();

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

    return (
        <>
            <Helmet title='Performance' />

            <p>Hello</p>
        </>
    );
}
