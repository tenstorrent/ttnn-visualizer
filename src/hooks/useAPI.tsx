// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import {
    OperationDescription,
    OperationDetailsData,
    ReportMetaData,
    defaultOperationDetailsData,
} from '../model/APIData';

const fetchOperationDetails = async (id: number | null): Promise<OperationDetailsData> => {
    if (id === null) {
        return defaultOperationDetailsData;
    }
    try {
        const { data: operationDetails } = await axios.get<OperationDetailsData>(`/api/operations/${id}`, {
            maxRedirects: 1,
        });
        return operationDetails;
    } catch (error: unknown) {
        if (axios.isAxiosError(error)) {
            if (error.response && error.response.status >= 400 && error.response.status < 500) {
                // we may want to handle this differently
                throw error;
            }
            if (error.response && error.response.status >= 500) {
                throw error;
            }
        }
    }
    return defaultOperationDetailsData;
};
const fetchOperations = async (): Promise<OperationDescription[]> => {
    const { data: operationList } = await axios.get<Omit<OperationDescription, 'microOperations'>[]>('/api/operations');

    return operationList.map((operation) => ({
        ...operation,
        nodes: operation.device_operations.map((deviceOperation) => ({
            id: deviceOperation.counter,
            connections: deviceOperation.connections,
            node_type: deviceOperation.node_type,
            params: deviceOperation.params,
        })),
    })) as OperationDescription[];
};

/** @description
 * this is a temporary method to fetch all buffers for all operations. it may not be used in the future
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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

export const useOperationDetails = (operationId: number | null) => {
    const { data: operations } = useOperationsList();
    const operation = operations?.filter((_operation) => {
        return _operation.id === operationId;
    })[0];
    const operationDetails = useQuery<OperationDetailsData>(
        ['get-operation-detail', operationId],
        () => fetchOperationDetails(operationId),
        {
            retry: 2,
            retryDelay: (retryAttempt) => Math.min(retryAttempt * 100, 500),
        },
    );

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

    return useOperationDetails(operation ? operation.id : null);
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
