// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import axiosInstance from '../libs/axiosInstance';
import {
    Buffer,
    BufferData,
    BufferPage,
    OperationDescription,
    OperationDetailsData,
    ReportMetaData,
    TabSession,
    TensorData,
    defaultBuffer,
    defaultOperationDetailsData,
    defaultTensorData,
} from '../model/APIData';
import { BufferType } from '../model/BufferType';
import parseMemoryConfig, { MemoryConfig } from '../functions/parseMemoryConfig';
import isValidNumber from '../functions/isValidNumber';

export const fetchTabSession = async (): Promise<TabSession | null> => {
    // eslint-disable-next-line promise/valid-params
    const response = await axiosInstance.get<TabSession>('/api/session').catch();
    return response?.data;
};

export const fetchBufferPages = async (
    operationId: number,
    address?: number | string,
    bufferType?: BufferType,
    deviceId?: number,
): Promise<BufferPage[]> => {
    const response = await axiosInstance.get<BufferPage[]>(`/api/buffer-pages`, {
        params: {
            operation_id: operationId,
            address,
            buffer_type: bufferType,
            device_id: deviceId,
        },
    });
    return response.data;
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

const fetchOperations = async (deviceId?: number): Promise<OperationDescription[]> => {
    const { data: operationList } = await axiosInstance.get<OperationDescription[]>('/api/operations', {
        params: {
            device_id: deviceId,
        },
    });

    return operationList.map((operation) => ({
        ...operation,
        arguments: operation.arguments.map((argument) =>
            argument.name === 'memory_config'
                ? {
                      ...argument,
                      parsedValue: argument.value ? (parseMemoryConfig(argument.value) as MemoryConfig) : null,
                  }
                : argument,
        ),
    }));
};

export interface BuffersByOperationData {
    buffers: Buffer[];
    id: number;
    name: string;
}

export interface DeviceData {
    address_at_first_l1_bank: number;
    address_at_first_l1_cb_buffer: number;
    cb_limit: number;
    device_id: number;
    l1_bank_size: number;
    l1_num_banks: number;
    num_banks_per_storage_core: number;
    num_compute_cores: number;
    num_storage_cores: number;
    num_x_compute_cores: number;
    num_x_cores: number;
    num_y_compute_cores: number;
    num_y_cores: number;
    total_l1_for_interleaved_buffers: number;
    total_l1_for_sharded_buffers: number;
    total_l1_for_tensors: number;
    total_l1_memory: number;
    worker_l1_size: number;
}

/** @description
 * this is a temporary method to fetch all buffers for all operations. it may not be used in the future
 */
const fetchAllBuffers = async (
    bufferType: BufferType | null,
    deviceId: number | null,
): Promise<BuffersByOperationData[]> => {
    const params = {
        buffer_type: bufferType,
        device_id: deviceId,
    };

    const { data: buffers } = await axiosInstance.get<BuffersByOperationData[]>('/api/operation-buffers', {
        params,
    });

    return buffers;
};

export const fetchOperationBuffers = async (operationId: number | null) => {
    const { data: buffers } = await axiosInstance.get(`/api/operation-buffers/${operationId}`);

    return buffers;
};

const fetchReportMeta = async (): Promise<ReportMetaData> => {
    const { data: meta } = await axiosInstance.get<ReportMetaData>('/api/config');

    return meta;
};

const fetchDevices = async () => {
    const { data: meta } = await axiosInstance.get<DeviceData[]>('/api/devices');

    return meta;
};

export const useOperationsList = (deviceId?: number) => {
    return useQuery<OperationDescription[], AxiosError>({
        queryFn: () => fetchOperations(deviceId),
        queryKey: ['get-operations', deviceId],
        retry: false,
    });
};

export const useOperationDetails = (operationId: number | null, deviceId?: number | null) => {
    const { data: operations } = useOperationsList();
    const operation = operations?.filter((_operation) => _operation.id === operationId)[0];

    const operationDetails = useQuery<OperationDetailsData>(
        ['get-operation-detail', operationId, deviceId],
        () => fetchOperationDetails(operationId),
        {
            retry: 2,
            retryDelay: (retryAttempt) => Math.min(retryAttempt * 100, 500),
        },
    );

    if (operationDetails.data) {
        operationDetails.data.buffers = operationDetails.data.buffers.filter((buffer) =>
            isValidNumber(deviceId) ? buffer.device_id === deviceId : true,
        );
    }

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

export const useBufferPages = (
    operationId: number,
    address?: number | string,
    bufferType?: BufferType,
    deviceId?: number,
) => {
    return useQuery<BufferPage[], AxiosError>(['get-buffer-pages', operationId, address, bufferType, deviceId], () =>
        fetchBufferPages(operationId, address, bufferType, deviceId),
    );
};

export const fetchTensors = async (deviceId?: number | null): Promise<TensorData[]> => {
    try {
        const { data: tensorList } = await axiosInstance.get<TensorData[]>('/api/tensors', {
            maxRedirects: 1,
            params: {
                device_id: deviceId,
            },
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

export const useTensors = (deviceId?: number | null) => {
    return useQuery<TensorData[], AxiosError>({
        queryFn: () => fetchTensors(deviceId),
        queryKey: ['get-tensors', deviceId],
        retry: false,
    });
};

export const useDevices = () => {
    return useQuery<DeviceData[], AxiosError>('get-devices', fetchDevices);
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

export const useBuffers = (bufferType: BufferType, deviceId: number | null) => {
    return useQuery({
        queryFn: () => fetchAllBuffers(bufferType, deviceId),
        queryKey: ['fetch-all-buffers', bufferType, deviceId],
    });
};
