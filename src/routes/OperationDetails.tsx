// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useParams } from 'react-router';
import { Helmet } from 'react-helmet-async';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';
import { useOperationDetails } from '../hooks/useAPI';
import { OperationDetailsData } from '../model/APIData';

export default function OperationDetails() {
    const { operationId } = useParams();
    const intOperationId = operationId ? parseInt(operationId, 10) : 0;
    const {
        operationDetails: { data: operationDetails, status },
    } = useOperationDetails(intOperationId);

    return (
        <>
            {status === 'success' ? <Helmet title={getTitle(status, intOperationId, operationDetails)} /> : null}
            <OperationDetailsComponent operationId={intOperationId} />
        </>
    );
}

const getTitle = (status: string, operationId: number, operationDetails?: OperationDetailsData) => {
    if (status === 'error') {
        return `Not found Operation ${operationId}`;
    }

    if (status === 'success' && operationDetails) {
        return `${operationId} ${operationDetails.name}`;
    }

    return '';
};
