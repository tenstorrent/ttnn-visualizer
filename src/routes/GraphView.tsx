// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React, { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams } from 'react-router';

import { toast } from 'react-toastify';
import { useOperationsList } from '../hooks/useAPI';
import OperationGraph from '../components/OperationGraphComponent';
import LoadingSpinner from '../components/LoadingSpinner';

const GraphView: React.FC = () => {
    const { data: operationList, isLoading } = useOperationsList();
    const { operationId } = useParams<{ operationId?: string }>();

    // Dismiss any toasts that are open
    useEffect(() => toast.dismiss(), []);

    return (
        <>
            <Helmet title='GraphTree' />
            {isLoading || !operationList ? (
                <div className='graph-tree-loader'>
                    <LoadingSpinner />
                </div>
            ) : (
                <OperationGraph
                    operationList={operationList}
                    operationId={operationId ? parseInt(operationId, 10) : undefined}
                />
            )}
        </>
    );
};

export default GraphView;
