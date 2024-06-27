import { useParams } from 'react-router';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';
import OperationDetailsNavigation from '../components/OperationDetailsNavigation';

export default function OperationDetails() {
    const { operationId } = useParams();

    return (
        operationId && (
            <>
                <OperationDetailsNavigation operationId={operationId} />
                <OperationDetailsComponent operationId={parseInt(operationId, 10)} />
            </>
        )
    );
}
