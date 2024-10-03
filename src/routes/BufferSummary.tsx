// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { useBuffers, useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import { BufferType } from '../model/BufferType';

export default function BufferSummary() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);
    const { data: buffersByOperation, isLoading } = useBuffers(BufferType.L1);

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

    console.log(buffersByOperation);

    return (
        <>
            <Helmet title='Buffers' />

            {isLoading ? (
                'Loading...'
            ) : (
                <ul>
                    {buffersByOperation?.map((operation) => (
                        <li>
                            {operation.id} - {operation.buffers.length}
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
