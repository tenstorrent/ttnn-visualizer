// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

/* eslint-disable @typescript-eslint/no-unused-vars */

import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import Papa, { ParseResult } from 'papaparse';
import { useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { NumberRange } from '@blueprintjs/core';
import axiosInstance from '../libs/axiosInstance';
import {
    Buffer,
    BufferData,
    BufferPage,
    NodeType,
    OperationDescription,
    OperationDetailsData,
    ReportMetaData,
    TabSession,
    Tensor,
    defaultBuffer,
    defaultOperationDetailsData,
    defaultTensorData,
} from '../model/APIData';
import { BufferType } from '../model/BufferType';
import parseMemoryConfig, { MemoryConfig, memoryConfigPattern } from '../functions/parseMemoryConfig';
import isValidNumber from '../functions/isValidNumber';
import { getUniqueDeviceIDs, mergeMultideviceRows } from '../functions/perfFunctions';
import { RowData } from '../definitions/PerfTable';
import { isDeviceOperation } from '../functions/filterOperations';
import { selectedOperationRangeAtom } from '../store/app';

const parseFileOperationIdentifier = (stackTrace: string): string => {
    const regex = /File\s+"(?:.+\/)?([^/]+)",\s+line\s+(\d+)/;
    const match = stackTrace.match(regex);

    if (match) {
        return `${match[1]}:${match[2]}`;
    }

    return '';
};

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
            // device_id: deviceId,
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
        return {
            ...operationDetails,
            operationFileIdentifier: parseFileOperationIdentifier(operationDetails.stack_trace),
        };
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
    const tensorList: Map<number, Tensor> = new Map<number, Tensor>();
    const { data: operationList } = await axiosInstance.get<OperationDescription[]>('/api/operations', {
        params: {
            device_id: deviceId,
        },
    });

    return operationList.map((operation: OperationDescription) => {
        operation.operationFileIdentifier = parseFileOperationIdentifier(operation.stack_trace);

        const outputs = operation.outputs.map((tensor) => {
            const tensorWithMetadata = {
                ...tensor,
                producerOperation: operation,
                operationIdentifier: `${operation.id} ${operation.name} ${operation.operationFileIdentifier}`,
            };

            tensorList.set(tensor.id, tensorWithMetadata);

            return { ...tensorWithMetadata, io: 'output' };
        });

        const inputs = operation.inputs.map((tensor) => {
            const cachedTensor = tensorList.get(tensor.id);
            if (cachedTensor) {
                return { ...cachedTensor, io: 'input' };
            }
            return { ...tensor, io: 'input' };
        });

        const argumentsWithParsedValues = operation.arguments.map((argument) =>
            argument.name === 'memory_config' || memoryConfigPattern.test(argument.value)
                ? {
                      ...argument,
                      parsedValue: argument.value ? (parseMemoryConfig(argument.value) as MemoryConfig) : null,
                  }
                : argument,
        );
        return {
            ...operation,
            operationFileIdentifier: parseFileOperationIdentifier(operation.stack_trace),
            outputs,
            inputs,
            arguments: argumentsWithParsedValues,
        } as OperationDescription;
    });
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

export interface PerformanceData {
    PCIe_slot: number;
    RISC_processor_type: string; // Can we scope this down to a specific set of values?
    core_x: number;
    core_y: number;
    run_ID: number;
    run_host_ID: number;
    source_file: string;
    source_line: number;
    stat_value: number;
    'time[cycles_since_reset]': number;
    timer_id: number;
    zone_name: string; // Can we scope this down to a specific set of values?
    zone_phase: 'begin' | 'end';
}

const fetchAllBuffers = async (bufferType: BufferType | null): Promise<BuffersByOperationData[]> => {
    const params = {
        buffer_type: bufferType,
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

const fetchPerformanceDataRaw = async (): Promise<ParseResult<Record<string, string>>> => {
    const { data } = await axiosInstance.get<string>('/api/profiler/perf-results/raw');

    return new Promise((resolve, reject) => {
        Papa.parse<Record<string, string>>(data, {
            complete: (results) => resolve(results),
            error: (error: Error) => reject(error),
            header: true,
        });
    });
};

interface MetaData {
    architecture: string | null;
    frequency: number | null;
}

interface FetchDeviceLogRawResult {
    deviceMeta: MetaData;
    deviceLog: ParseResult<Record<string, string>[]>;
}

const fetchDeviceLogRaw = async (): Promise<FetchDeviceLogRawResult> => {
    const { data } = await axiosInstance.get<string>('/api/profiler/device-log/raw');

    function parseArchAndFreq(input: string): MetaData {
        const archMatch = input.match(/ARCH:\s*([\w\d_]+)/);
        const freqMatch = input.match(/CHIP_FREQ\[MHz\]:\s*(\d+)/);
        const architecture = archMatch ? archMatch[1] : null;
        const frequency = freqMatch ? parseInt(freqMatch[1], 10) : null;

        return { architecture, frequency };
    }

    return new Promise<FetchDeviceLogRawResult>((resolve, reject) => {
        const rows = data.split('\n');
        const csv = rows.slice(1); // Remove the first row
        const deviceMeta = parseArchAndFreq(rows[0]);
        const headers = csv!
            .shift()!
            .split(/,\s{1,2}/)
            .join(','); // headers without spaces
        const processedCsv = [headers, ...csv].join('\n');
        Papa.parse<Record<string, string>[]>(processedCsv, {
            header: true,
            complete: (deviceLog) => resolve({ deviceMeta, deviceLog }),
            error: (error: Error) => reject(error),
        });
    });
};

export const useOperationsList = () =>
    useQuery<OperationDescription[], AxiosError>({
        queryFn: () => fetchOperations(),
        queryKey: ['get-operations'],
        retry: false,
    });

export const useOperationListRange = (): NumberRange | null => {
    const response = useOperationsList();

    return useMemo(
        () => (response.data ? [response.data?.[0].id, response.data?.[response.data.length - 1].id] : null),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [response.isLoading],
    );
};

export const useOperationDetails = (operationId: number | null) => {
    const { data: operations } = useOperationsList();
    const operation = operations?.filter((_operation) => _operation.id === operationId)[0];

    // TEMP device id handling
    const deviceId = 0;

    const operationDetails = useQuery<OperationDetailsData>(
        ['get-operation-detail', operationId, deviceId],
        () => fetchOperationDetails(operationId),
        {
            retry: 2,
            retryDelay: (retryAttempt) => Math.min(retryAttempt * 100, 500),
        },
    );

    // TEMP device id handling
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

export const useGetDeviceOperationsListByOp = () => {
    const { data: operations } = useOperationsList();

    return useMemo(() => {
        return (
            operations
                ?.map((operation) => {
                    const ops = operation.device_operations
                        .filter((op) => op.node_type === NodeType.function_start)
                        .map((deviceOperation) => deviceOperation.params.name)
                        .filter((opName) => isDeviceOperation(opName));
                    return { id: operation.id, name: operation.name, ops };
                })
                .filter((data) => {
                    return data.ops.length > 0;
                }) || []
        );
    }, [operations]);
};

export const useGetDeviceOperationsList = (): DeviceOperationMapping[] => {
    const { data: operations } = useOperationsList();
    const { data: devices } = useDevices();

    /**
     * TODO: update when device op data is device bound
     * @description Collapse multi-device operations into single entry temporary logic, this can under certain circumstances lead to false positives
     * @param data
     * @param numDevices
     */
    const collapseMultideviceOPs = (data: DeviceOperationMapping[], numDevices: number): DeviceOperationMapping[] => {
        if (numDevices === 1) {
            return data;
        }

        const result: DeviceOperationMapping[] = [];
        const operationCountByKey = new Map<string, number>();

        for (const { name, id } of data) {
            const key = `${name}-${id}`;
            operationCountByKey.set(key, (operationCountByKey.get(key) || 0) + 1);
        }

        const seen = new Set<string>();

        for (const item of data) {
            const key = `${item.name}-${item.id}`;
            if (!seen.has(key) && operationCountByKey.get(key) === numDevices) {
                result.push(item);
                seen.add(key);
            }
        }

        return result;
    };

    return useMemo(() => {
        if (!operations || !devices) {
            return [];
        }
        const result = operations.flatMap((operation) =>
            operation.device_operations
                .filter(
                    (op) =>
                        op.node_type === NodeType.function_start && op.params.name && isDeviceOperation(op.params.name),
                )
                .map((deviceOperation) => ({
                    name: deviceOperation.params.name,
                    id: operation.id,
                    operationName: operation.name,
                })),
        );
        return collapseMultideviceOPs(result, devices.length);
    }, [operations, devices]);
};

export interface DeviceOperationMapping {
    name: string;
    id: number;
    operationName: string;
    perfData?: RowData;
}

export const useNormalizedPerformance = (): RowData[] => {
    const response = usePerformance();

    return useMemo(() => {
        if (!response?.data?.data || response?.data.data.length === 0) {
            return [];
        }
        // @ts-expect-error this should be just fine
        let df: RowData[] = (response.data.data.slice() as RowData[]).filter(
            (r) => !r['OP CODE']?.includes('(torch)') && !(r['OP CODE'] === ''),
        );

        df.forEach((r, index) => {
            r.ORIGINAL_ID = index + 2;
        });

        if (df.length > 0 && 'HOST START TS' in df[0]) {
            df = df.sort((a, b) => Number(a['HOST START TS'] || 0) - Number(b['HOST START TS'] || 0));
        }

        const uniqueDeviceIDs = getUniqueDeviceIDs(df);

        if (uniqueDeviceIDs.length > 1) {
            df = mergeMultideviceRows(df);
        }

        return df;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [response.isLoading]);
};

export const useGetDeviceOperationListPerf = () => {
    const deviceOperations: DeviceOperationMapping[] = useGetDeviceOperationsList();
    const data = useNormalizedPerformance();

    return useMemo(() => {
        const isValid = deviceOperations.every((deviceOperation, index) => {
            const perfData = data[index];
            if (perfData && perfData['OP CODE'] === deviceOperation.name) {
                deviceOperation.perfData = perfData;
                return true;
            }
            return false;
        });
        return isValid ? deviceOperations : [];
    }, [data, deviceOperations]);
};

/**
 * @description op id to perf id mapping with all Op ids including missing perf ids and host ids
 */
export const useOptoPerfIdAll = () => {
    const { data: operations } = useOperationsList();
    const deviceOperations: DeviceOperationMapping[] = useGetDeviceOperationsList();
    const data = useNormalizedPerformance();

    return useMemo(() => {
        const ids = deviceOperations.map((deviceOperation, index) => {
            const perfData = data[index];
            return perfData && perfData['OP CODE'] === deviceOperation.name
                ? { opId: deviceOperation.id, perfId: perfData.ORIGINAL_ID }
                : { opId: deviceOperation.id, perfId: -1 };
        });

        return (
            operations?.map((operation) => {
                const op = ids.find((id) => id.opId === operation.id);
                return op || { opId: operation.id, perfId: -1 };
            }) || []
        );
    }, [data, deviceOperations, operations]);
};

/**
 * @description op id to perf id mapping only for existing perf ids
 */
export const useOptoPerfIdFiltered = () => {
    const opMapping = useGetDeviceOperationListPerf();
    return useMemo(
        () =>
            opMapping.map(({ id, perfData }) => {
                return {
                    opId: id,
                    perfId: perfData?.ORIGINAL_ID,
                };
            }),
        [opMapping],
    );
};

export const usePerformanceRange = (): NumberRange | null => {
    const response = useNormalizedPerformance();

    return useMemo(
        () =>
            response?.length
                ? ([response[0].ORIGINAL_ID, response[response.length - 1].ORIGINAL_ID] as NumberRange)
                : null,

        [response],
    );
};

// Not currently used
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

export const fetchTensors = async (deviceId?: number | null): Promise<Tensor[]> => {
    try {
        const { data: tensorList } = await axiosInstance.get<Tensor[]>('/api/tensors', {
            maxRedirects: 1,
            params: {
                // device_id: deviceId,
            },
        });

        const operationsList = await fetchOperations();

        for (const tensor of tensorList) {
            if (tensor.producers.length > 0) {
                const producerId = tensor.producers[0];
                const operationDetails = operationsList.find((operation) => operation.id === producerId);
                const outputTensor = operationDetails?.outputs.find((output) => output.id === tensor.id);

                if (outputTensor) {
                    tensor.operationIdentifier = outputTensor.operationIdentifier;
                }
            }
        }

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

export const useTensors = (useRange?: boolean, deviceId?: number | null) => {
    const range = useAtomValue(selectedOperationRangeAtom);

    const response = useQuery<Tensor[], AxiosError>({
        queryFn: () => fetchTensors(deviceId),
        queryKey: ['get-tensors', deviceId],
        retry: false,
    });

    return useMemo(() => {
        if (response.data && range && useRange) {
            response.data = response.data.filter(
                (tensor) =>
                    tensor.consumers.some((id) => id >= range[0] && id <= range[1]) ||
                    tensor.producers.some((id) => id >= range[0] && id <= range[1]),
            );
        }

        return response;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range, response.isLoading, useRange]);
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

export const useBuffers = (bufferType: BufferType, useRange?: boolean) => {
    const range = useAtomValue(selectedOperationRangeAtom);

    const response = useQuery({
        queryFn: () => fetchAllBuffers(bufferType),
        queryKey: ['fetch-all-buffers', bufferType],
    });

    return useMemo(() => {
        if (response.data && range && useRange) {
            response.data = response.data.filter((operation) => operation.id >= range[0] && operation.id <= range[1]);
        }

        return response;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range, response.isLoading, useRange]);
};

export const useDeviceLog = () => {
    return useQuery({
        queryFn: () => fetchDeviceLogRaw(),
        queryKey: 'get-device-log-raw',
    });
};

export const usePerformance = () => {
    return useQuery({
        queryFn: () => fetchPerformanceDataRaw(),
        queryKey: 'get-performance-data-raw',
    });
};

export const useSession = (reportName: string | null, profileName: string | null) => {
    return useQuery({
        queryFn: () => fetchTabSession(),
        queryKey: ['get-session', reportName, profileName],
        initialData: null,
    });
};
