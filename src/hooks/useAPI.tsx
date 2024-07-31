import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import { OperationDetailsData, ReportMetaData } from '../model/APIData';
import { Operation } from '../model/Graph';

const fetchOperationDetails = async (id: number): Promise<OperationDetailsData> => {
    const response = await axios.get<OperationDetailsData>(`/api/get-operation-details/${id}`);

    return response.data;
};
const fetchOperations = async (): Promise<Operation[]> => {
    const { data: operationList } = await axios.get<Operation[]>('/api/get-operations');

    return operationList;
};
const fetchAllBuffers = async (): Promise<any> => {
    const { data: buffers } = await axios.get('/api/get-operation-buffers');

    return buffers;
};

const fetchReportMeta = async (): Promise<ReportMetaData> => {
    const { data: meta } = await axios.get<ReportMetaData>('/api/get-config');

    return meta;
};

export const useOperationsList = () => {
    return useQuery<Operation[], AxiosError>('get-operations', fetchOperations);
};

export const useAllBuffers = () => {
    return useQuery<{ operation_id: number; buffers: [] }[], AxiosError>('get-operation-buffers', fetchAllBuffers);
};

export const useOperationDetails = (operationId: number) => {
    const { data: operations } = useOperationsList();
    const operation = operations?.filter((_operation) => {
        return _operation.id === operationId;
    })[0];
    const operationDetails = useQuery<OperationDetailsData>(['get-operation-detail', operationId], () =>
        fetchOperationDetails(operationId),
    );

    // TODO: consider useQueries or include operation data on BE

    return {
        operation,
        operationDetails,
    };
};

export const usePreviousOperationDetails = (operationId: number) => {
    // TODO: change to return array and number of previous operations
    const { data: operations } = useOperationsList();

    const operation = operations?.find((_operation, index, operationList) => {
        return operationList[index + 1]?.id === operationId;
    });

    return useOperationDetails(operation?.id || -1);
};

export const usePreviousOperation = (operationId: number) => {
    const { data: operations } = useOperationsList();

    const operation = operations?.find((_operation, index, operationList) => {
        return operationList[index + 1]?.id === operationId;
    });

    return operation ? { id: operation.id, name: operation.name } : undefined;
};

export const useNextOperation = (operationId: number) => {
    const { data: operations } = useOperationsList();

    const operation = operations?.find((_operation, index, operationList) => {
        return operationList[index - 1]?.id === operationId;
    });

    return operation ? { id: operation.id, name: operation.name } : undefined;
};

export const useReportMeta = () => {
    return useQuery<ReportMetaData, AxiosError>('fetch-report-meta', fetchReportMeta);
};
