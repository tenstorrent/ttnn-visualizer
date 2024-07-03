import { useParams } from 'react-router';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';
import OperationDetailsNavigation from '../components/OperationDetailsNavigation';

export default function OperationDetails() {
    const { operationId } = useParams();
    const operationIdAsInt = operationId ? parseInt(operationId, 10) : 0;

    return (
        operationId && (
            <>
                <OperationDetailsNavigation operationId={operationIdAsInt} />
                <OperationDetailsComponent operationId={operationIdAsInt} />
            </>
        )
    );
}
