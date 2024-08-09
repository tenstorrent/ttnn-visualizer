// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import { MicroOperation, OperationDescription, OperationDetailsData, ReportMetaData } from '../model/APIData';

const fetchOperationDetails = async (id: number): Promise<OperationDetailsData> => {
    const { data: operationDetails } = await axios.get<OperationDetailsData>(`/api/operations/${id}`);
    return operationDetails;
};
const fetchOperations = async (): Promise<OperationDescription[]> => {
    const [{ data: operationList }, { data: microOperations }] = await Promise.all([
        axios.get<Omit<OperationDescription, 'microOperations'>[]>('/api/operations'),
        axios.get<MicroOperation[]>('/api/operation-history'),
    ]);

    return operationList.map((operation) => ({
        ...operation,
        microOperations:
            microOperations.filter((microOperation) => microOperation.ttnn_operation_id === operation.id) || [],
    })) as OperationDescription[];
};

const fetchAllBuffers = async (): Promise<any> => {
    const { data: buffers } = await axios.get('/api/get-operation-buffers');

    return buffers;
};

const fetchReportMeta = async (): Promise<ReportMetaData> => {
    const { data: meta } = await axios.get<ReportMetaData>('/api/config');

    return meta;
};

export const useOperationsList = () => {
    return useQuery<OperationDescription[], AxiosError>('get-operations', fetchOperations);
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

    return useOperationDetails(operation ? operation.id : -1);
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
    return useQuery<ReportMetaData, AxiosError>('get-report-config', fetchReportMeta);
};
