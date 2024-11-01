// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams } from 'react-router';

import { useOperationsList } from '../hooks/useAPI';
import OperationGraph from '../components/OperationGraphComponent';
import LoadingSpinner from '../components/LoadingSpinner';

const GraphView: React.FC = () => {
    const { data: operationList, isLoading } = useOperationsList();
    const { operationId } = useParams<{ operationId?: string }>();
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
