// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import axiosInstance from '../libs/axiosInstance';
import {
    ActiveReport,
    BufferData,
    OperationDescription,
    OperationDetailsData,
    ReportMetaData,
    TensorData,
    defaultBuffer,
    defaultOperationDetailsData,
    defaultTensorData,
} from '../model/APIData';

export const fetchActiveReport = async (): Promise<ActiveReport | null> => {
    const response = await axiosInstance.get<ActiveReport>('/api/reports/active').catch();
    return response?.data;
};

const fetchOperationDetails = async (id: number | null): Promise<OperationDetailsData> => {
    if (id === null) {
        return defaultOperationDetailsData;
    }
    try {
        const { data: operationDetails } = await axiosInstance.get<OperationDetailsData>(`/api/operations/${id}`, {
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
    const { data: operationList } = await axiosInstance.get<OperationDescription[]>('/api/operations');

    return operationList;
};

/** @description
 * this is a temporary method to fetch all buffers for all operations. it may not be used in the future
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fetchAllBuffers = async (): Promise<any> => {
    const { data: buffers } = await axiosInstance.get('/api/get-operation-buffers');

    return buffers;
};

const fetchReportMeta = async (): Promise<ReportMetaData> => {
    const { data: meta } = await axiosInstance.get<ReportMetaData>('/api/config');

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

export const fetchTensors = async (): Promise<TensorData[]> => {
    try {
        const { data: tensorList } = await axiosInstance.get<TensorData[]>('/api/tensors', {
            maxRedirects: 1,
        });

        return tensorList;
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

    return [defaultTensorData];
};

export const useTensors = () => {
    return useQuery<TensorData[], AxiosError>('get-tensors', fetchTensors);
};

export const fetchNextUseOfBuffer = async (address: number | null, consumers: number[]): Promise<BufferData> => {
    if (!address || !consumers.length) {
        return defaultBuffer;
    }

    const { data: buffer } = await axiosInstance.get(
        `/api/buffer?address=${address}&operation_id=${consumers[consumers.length - 1]}`,
    );

    buffer.next_usage = buffer.operation_id - consumers[consumers.length - 1];

    return buffer;
};

export const useNextBuffer = (address: number | null, consumers: number[], queryKey: string) => {
    return useQuery<BufferData, AxiosError>(queryKey, {
        queryFn: () => fetchNextUseOfBuffer(address, consumers),
        retry: false,
    });
};
