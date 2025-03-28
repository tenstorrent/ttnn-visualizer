// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { useParams } from 'react-router';

import { useAtomValue } from 'jotai';
import { useOperationsList } from '../hooks/useAPI';
import OperationGraph from '../components/OperationGraphComponent';
import LoadingSpinner from '../components/LoadingSpinner';
import useClearSelectedBuffer from '../functions/clearSelectedBuffer';
import { selectedOperationRangeAtom } from '../store/app';

const GraphView: React.FC = () => {
    const { data: operationList, isLoading } = useOperationsList();
    const { operationId } = useParams<{ operationId?: string }>();
    const selectedOperationRange = useAtomValue(selectedOperationRangeAtom);

    useClearSelectedBuffer();

    const filteredOperationList = useMemo(
        () =>
            selectedOperationRange
                ? operationList?.filter((op) => selectedOperationRange[0] && op.id <= selectedOperationRange[1])
                : operationList,
        [operationList, selectedOperationRange],
    );

    return (
        <div className='data-padding'>
            <Helmet title='GraphTree' />

            {isLoading || !filteredOperationList ? (
                <div className='graph-tree-loader'>
                    <LoadingSpinner />
                </div>
            ) : (
                <OperationGraph
                    operationList={filteredOperationList}
                    operationId={operationId ? parseInt(operationId, 10) : undefined}
                />
            )}
        </div>
    );
};

export default GraphView;
