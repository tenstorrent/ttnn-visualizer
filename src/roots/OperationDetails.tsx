import { useLoaderData, useParams } from 'react-router';

interface TempInterface {
    message: string;
}

export default function OperationDetails() {
    const { message } = useLoaderData() as TempInterface;
    const { opId } = useParams();

    return <p>{`${message}: ${opId}`}</p>;
}
