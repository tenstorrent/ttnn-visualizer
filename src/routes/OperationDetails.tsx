import { useParams } from 'react-router';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';
import OperationDetailsNavigation from '../components/OperationDetailsNavigation';
import { useOperationDetails } from '../hooks/useAPI';

export default function OperationDetails() {
    const [isFullStackTrace, setIsFullStackTrace] = useState(false);
    const { operationId } = useParams();
    const intOperationId = operationId ? parseInt(operationId, 10) : 0;
    const { operation } = useOperationDetails(intOperationId);

    return (
        operationId && (
            <>
                <Helmet title={`${operationId} ${operation?.name}`} />
                <OperationDetailsNavigation
                    operationId={intOperationId}
                    isFullStackTrace={isFullStackTrace}
                />
                <OperationDetailsComponent
                    operationId={intOperationId}
                    isFullStackTrace={isFullStackTrace}
                    toggleStackTraceHandler={setIsFullStackTrace}
                />
            </>
        )
    );
}
