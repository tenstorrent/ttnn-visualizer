// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';
import { useOperationDetails } from '../hooks/useAPI';

export default function OperationDetails() {
    const { operationId } = useParams();
    const intOperationId = operationId ? parseInt(operationId, 10) : 0;
    const { operation } = useOperationDetails(intOperationId);

    return (
        operationId && (
            <>
                <Helmet
                    title={operation?.name ? `${operationId} ${operation?.name}` : `Not found Operation ${operationId}`}
                />

                <OperationDetailsComponent operationId={intOperationId} />
            </>
        )
    );
}
