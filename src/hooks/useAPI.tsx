import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import { OperationDetailsData } from '../model/APIData';
import { Operation } from '../model/Graph';

const fetchOperationDetails = async (id: number): Promise<OperationDetailsData> => {
    const response = await axios.get<OperationDetailsData>(`/api/get-operation-details/${id}`);
    return response.data;
};
const fetchOperations = async (): Promise<Operation[]> => {
    const { data: operationList } = await axios.get<Operation[]>('/api/get-operations');
    return operationList;
};

export const useOperationsList = () => {
    return useQuery<Operation[], AxiosError>('get-operations', fetchOperations);
};

export const useOperationDetails = (operationId: number) => {
    const { data: operations } = useOperationsList();
    const operation = operations?.filter((_operation) => {
        return _operation.id === operationId;
    })[0];
    const operationDetails = useQuery<OperationDetailsData>(['get-operation-detail', operationId], () =>
        fetchOperationDetails(operationId),
    );

    return {
        operation,
        operationDetails,
    };
};

export const usePreviousOperationDetails = (operationId: number) => {
    const { data: operations } = useOperationsList();

    const operation = operations?.find((_operation, index, operationList) => {
        return operationList[index + 1]?.id === operationId;
    });

    return useOperationDetails(operation?.id || -1);
};
