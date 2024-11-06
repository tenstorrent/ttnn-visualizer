// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useSetAtom } from 'jotai';
import { useEffect } from 'react';
import { toast } from 'react-toastify';
import { useReportMeta } from '../hooks/useAPI';
import { reportMetaAtom } from '../store/app';
import TensorList from '../components/TensorList';

export default function Tensors() {
    const report = useReportMeta();
    const setMeta = useSetAtom(reportMetaAtom);

    // Dismiss any toasts that are open
    toast.dismiss();

    // Needs to be in a useEffect to avoid a bad setState call
    useEffect(() => {
        if (report.status === 'success' && report.data) {
            setMeta(report.data);
        }
    }, [report, setMeta]);

    return (
        <>
            <Helmet title='Tensors' />
            <TensorList />
        </>
    );
}
