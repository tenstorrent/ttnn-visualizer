import { useLoaderData, useParams } from 'react-router';
import OperationDetailsComponent from '../components/OperationDetailsComponent.tsx';



export default function OperationDetails() {
    const { opId } = useParams();

    return <OperationDetailsComponent operationId={opId} />;
}
