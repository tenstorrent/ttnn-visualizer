import React from 'react';
import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';

interface OperationDetailsProps {
    operationId: string;
}

const OperationDetailsComponent: React.FC<OperationDetailsProps> = ({ operationId }) => {
    const fetchOperations = async () => {
        const { data } = await axios.get(`/api/get-operation-details/${operationId}`);
        return data;
    };
    const { data, error, isLoading } = useQuery<any, AxiosError>('operations', fetchOperations);

    console.log(data, error, isLoading);
    return <div className='operation-details'>Operation details</div>;
};

export default OperationDetailsComponent;
