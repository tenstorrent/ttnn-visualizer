import { useParams } from 'react-router';
import OperationDetailsComponent from '../components/OperationDetailsComponent';

export default function OperationDetails() {
    const { operationId } = useParams();

    return operationId && <OperationDetailsComponent operationId={parseInt(operationId, 10)} />;
}
