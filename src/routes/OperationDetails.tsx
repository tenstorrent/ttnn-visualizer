import { useParams } from 'react-router';
import OperationDetailsComponent from '../components/operation-details/OperationDetailsComponent';

export default function OperationDetails() {
    const { operationId } = useParams();
    const intOperationId = operationId ? parseInt(operationId, 10) : 0;

    return operationId && <OperationDetailsComponent operationId={intOperationId} />;
}
