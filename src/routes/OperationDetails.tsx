import { useParams } from 'react-router';
import { useState } from 'react';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';
import OperationDetailsNavigation from '../components/OperationDetailsNavigation';

export default function OperationDetails() {
    const [isFullStackTrace, setIsFullStackTrace] = useState(false);
    const { operationId } = useParams();
    const operationIdAsInt = operationId ? parseInt(operationId, 10) : 0;

    return (
        operationId && (
            <>
                <OperationDetailsNavigation
                    operationId={operationIdAsInt}
                    isFullStackTrace={isFullStackTrace}
                />
                <OperationDetailsComponent
                    operationId={operationIdAsInt}
                    isFullStackTrace={isFullStackTrace}
                    toggleStackTraceHandler={setIsFullStackTrace}
                />
            </>
        )
    );
}
