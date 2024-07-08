import { useParams } from 'react-router';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';
import OperationDetailsNavigation from '../components/OperationDetailsNavigation';

export default function OperationDetails() {
    const [isFullStackTrace, setIsFullStackTrace] = useState(false);
    const { operationId } = useParams();
    const intOperationId = operationId ? parseInt(operationId, 10) : 0;

    return (
        operationId && (
            <>
                <Helmet title={`Operation ${operationId}`} />
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
