// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import { useQuery } from 'react-query';
import Papa, { ParseResult } from 'papaparse';
import { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { NumberRange } from '@blueprintjs/core';
import Ajv from 'ajv';
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
import { PerfTableRow } from '../definitions/PerfTable';
import { isDeviceOperation } from '../functions/filterOperations';
import {
    activeNpeOpTraceAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    selectedOperationRangeAtom,
} from '../store/app';
import archWormhole from '../assets/data/arch-wormhole.json';
import archBlackhole from '../assets/data/arch-blackhole.json';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import { NPEData, NPEManifestEntry } from '../model/NPEModel';
import { ChipDesign, ClusterModel } from '../model/ClusterModel';
import npeManifestSchema from '../schemas/npe-manifest.schema.json';

const parseFileOperationIdentifier = (stackTrace: string): string => {
    const regex = /File\s+"(?:.+\/)?([^/]+)",\s+line\s+(\d+)/;
    const match = stackTrace.match(regex);

    if (match) {
        return `${match[1]}:${match[2]}`;
    }

    return '';
};

// Possibly rename this and related functions to be "Instance"
export const fetchTabSession = async (): Promise<TabSession | null> => {
    // eslint-disable-next-line promise/valid-params
    const response = await axiosInstance.get<TabSession>('/api/instance').catch();
    return response?.data;
};

export const updateTabSession = async (payload: Partial<TabSession>): Promise<TabSession | null> => {
    // eslint-disable-next-line promise/valid-params
    const response = await axiosInstance.put<TabSession>('/api/instance', payload).catch();
    return response?.data;
};

export const fetchBufferPages = async (
    operationId: number,
    address?: number | string,
    bufferType?: BufferType,
): Promise<BufferPage[]> => {
    const response = await axiosInstance.get<BufferPage[]>(`/api/buffer-pages`, {
        params: {
            operation_id: operationId,
            address,
            buffer_type: bufferType,
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

const fetchOperations = async (): Promise<OperationDescription[]> => {
    const tensorList: Map<number, Tensor> = new Map<number, Tensor>();
    const { data: operationList } = await axiosInstance.get<OperationDescription[]>('/api/operations');

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

const fetchBuffersByOperation = async (bufferType: BufferType | null): Promise<BuffersByOperationData[]> => {
    const params = {
        buffer_type: bufferType,
    };

    const { data: buffers } = await axiosInstance.get<BuffersByOperationData[]>('/api/operation-buffers', {
        params,
    });

    return buffers;
};

const fetchAllBuffers = async (bufferType: BufferType | null): Promise<Buffer[]> => {
    const params = {
        buffer_type: bufferType,
    };

    const { data: buffers } = await axiosInstance.get<Buffer[]>('/api/buffers', {
        params,
    });

    return buffers;
};

const useGetAllBuffers = (bufferType: BufferType | null) => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery<Buffer[], AxiosError>({
        queryFn: () => fetchAllBuffers(bufferType),
        queryKey: ['fetch-all-buffers', bufferType, activeProfilerReport],
        staleTime: Infinity,
    });
};

/**
 * @description returns start address of the first L1 small buffer. this is interim solution until BE can collect to devices table
 */
export const useGetL1SmallMarker = (): number => {
    const { data: buffers } = useGetAllBuffers(BufferType.L1_SMALL);

    return useMemo(() => {
        const addresses = buffers?.map((buffer) => {
            return buffer.address;
        }) || [0];
        return Math.min(...addresses);
    }, [buffers]);
};

/**
 * @description returns start of a usable memory region for L1. This assumes identical device configuration.
 */
export const useGetL1StartMarker = (): number => {
    const { data: devices } = useDevices();

    return useMemo(() => {
        if (devices && devices.length > 0) {
            return devices[0].address_at_first_l1_cb_buffer;
        }
        return 0;
    }, [devices]);
};

export const fetchOperationBuffers = async (operationId: number) => {
    const { data: buffers } = await axiosInstance.get(`/api/operation-buffers/${operationId}`);

    return buffers;
};

export const useOperationBuffers = (operationId: number) => {
    return useQuery<BuffersByOperationData, AxiosError>({
        queryKey: ['get-operation-buffers', operationId],
        queryFn: () => fetchOperationBuffers(operationId),
        retry: false,
        staleTime: Infinity,
    });
};

const fetchReportMeta = async (): Promise<ReportMetaData> => {
    const { data: meta } = await axiosInstance.get<ReportMetaData>('/api/config');

    return meta;
};

const fetchDevices = async () => {
    const { data: meta } = await axiosInstance.get<DeviceData[]>('/api/devices');
    if (meta.length === 0) {
        // TODO: make this an in app message - https://github.com/tenstorrent/ttnn-visualizer/issues/739
        // eslint-disable-next-line no-console
        console.error('Data integrity warning: No device information provided.');
    }
    return [...new Map(meta.map((device) => [device.device_id, device])).values()];
};

// Not currently used
// const fetchPerformanceDataRaw = async (): Promise<ParseResult<Record<string, string>>> => {
//     const { data } = await axiosInstance.get<string>('/api/performance/perf-results/raw');

//     return new Promise((resolve, reject) => {
//         Papa.parse<Record<string, string>>(data, {
//             complete: (results) => resolve(results),
//             error: (error: Error) => reject(error),
//             header: true,
//         });
//     });
// };

const fetchPerformanceReport = async (name?: string | null): Promise<PerfTableRow[]> => {
    const { data } = await axiosInstance.get<PerfTableRow[]>(`/api/performance/perf-results/report`, {
        params: { name },
    });

    return data;
};

const fetchNPEManifest = async (): Promise<NPEManifestEntry[]> => {
    const ajv = new Ajv();
    const validateNPEManifest = ajv.compile(npeManifestSchema);
    const { data } = await axiosInstance.get<NPEManifestEntry[]>(`/api/performance/npe/manifest`);
    const valid = validateNPEManifest(data);
    if (!valid) {
        // eslint-disable-next-line no-console
        console.error('Invalid NPE manifest:', validateNPEManifest.errors);
        throw new Error(validateNPEManifest.errors?.map((err) => ` ${err.message}`).join(', '));
    }
    return data;
};

export const useGetNPEManifest = () => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    return useQuery<NPEManifestEntry[], AxiosError>({
        queryFn: () => fetchNPEManifest(),
        queryKey: ['get-npe-manifest', activePerformanceReport],
        retry: false,
    });
};

const fetchNPETimeline = async (fileName: string): Promise<NPEData> => {
    const { data } = await axiosInstance.get<NPEData>(`/api/performance/npe/timeline`, {
        params: { filename: fileName },
    });

    return data;
};

export const useNPETimelineFile = (fileName: string | undefined) => {
    return useQuery<NPEData, AxiosError>({
        queryFn: () => fetchNPETimeline(fileName!),
        queryKey: ['get-npe-timeline', fileName],
        retry: false,
        enabled: !!fileName,
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
    const { data } = await axiosInstance.get<string>('/api/performance/device-log/raw');

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

const fetchClusterDescription = async (): Promise<ClusterModel> => {
    const { data } = await axiosInstance.get<ClusterModel>('/api/cluster-descriptor');
    return data;
};

export const useGetClusterDescription = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery({
        queryFn: () => fetchClusterDescription(),
        queryKey: ['get-cluster-description', activeProfilerReport],
        initialData: null,
        retry: false,
    });
};

export const useOperationsList = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    return useQuery<OperationDescription[], AxiosError>({
        queryFn: () => (activeProfilerReport !== null ? fetchOperations() : Promise.resolve([])),
        queryKey: ['get-operations', activeProfilerReport],
        retry: false,
        staleTime: Infinity,
    });
};

export const useOperationListRange = (): NumberRange | null => {
    const response = useOperationsList();

    return useMemo(
        () => (response?.data?.length ? [response.data?.[0].id, response.data?.[response.data.length - 1].id] : null),
        // TODO: this used to rely on response.isLoading... which iis an invalid dependency. will have to wait for david to come  bakc.
        // this fixes #613 https://github.com/tenstorrent/ttnn-visualizer/issues/613
        [response.data],
    );
};

const fetchNpeOpTrace = async () => {
    const response = await axiosInstance.get<NPEData>('/api/npe');
    return response?.data;
};

export const useNpe = (fileName: string | null) =>
    useQuery<NPEData, AxiosError>({
        queryFn: () => fetchNpeOpTrace(),
        queryKey: ['fetch-npe', fileName],
        retry: false,
        staleTime: 30000,
    });

export const useOperationDetails = (operationId: number | null) => {
    const { data: operations } = useOperationsList();

    // Memoize the operation lookup
    const operation = useMemo(
        () => operations?.find((_operation) => _operation.id === operationId) || null,
        [operations, operationId],
    );

    // Memoized function for fetching operation details
    const fetchDetails = useCallback(() => fetchOperationDetails(operationId), [operationId]);

    const operationDetails = useQuery<OperationDetailsData>(['get-operation-detail', operationId], fetchDetails, {
        retry: 2,
        retryDelay: (retryAttempt) => Math.min(retryAttempt * 100, 500),
        staleTime: Infinity,
    });

    const buffersSummary = useMemo(() => {
        if (!operationDetails.data) {
            return [];
        }

        const uniqueBuffers: Map<number, BufferData> = new Map<number, BufferData>();

        operationDetails.data.buffers.forEach((buffer) => {
            // eslint-disable-next-line camelcase
            const { address, max_size_per_bank } = buffer;

            if (address) {
                const existingBuffer = uniqueBuffers.get(address);
                // eslint-disable-next-line camelcase
                if (!existingBuffer || max_size_per_bank > existingBuffer.max_size_per_bank) {
                    uniqueBuffers.set(address, buffer);
                }
            }
        });

        return Array.from(uniqueBuffers.values());
    }, [operationDetails.data]);

    if (operationDetails.data) {
        operationDetails.data.buffersSummary = buffersSummary;
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
    perfData?: PerfTableRow;
}

// Unused
const useProxyPerformanceReport = (): PerfTableRow[] => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const response = usePerformanceReport(activePerformanceReport);

    return useMemo(() => {
        if (!response.data) {
            return [];
        }
        return response.data;
    }, [response.data]);
};

export const useGetDeviceOperationListPerf = () => {
    const deviceOperations: DeviceOperationMapping[] = useGetDeviceOperationsList();
    const data = useProxyPerformanceReport();

    return useMemo(() => {
        const isValid = deviceOperations.every((deviceOperation, index) => {
            const perfData = data[index];
            if (perfData && perfData.raw_op_code === deviceOperation.name) {
                deviceOperation.perfData = perfData;
                return true;
            }
            return false;
        });
        return isValid ? deviceOperations : [];
    }, [data, deviceOperations]);
};

/**
 * @description op id to perf id mapping only for existing perf ids
 */
export const useOpToPerfIdFiltered = () => {
    const opMapping = useGetDeviceOperationListPerf();

    return useMemo(
        () =>
            opMapping.map(({ id, perfData }) => {
                return {
                    opId: id,
                    perfId: perfData?.id,
                };
            }),
        [opMapping],
    );
};

export const usePerformanceRange = (): NumberRange | null => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const { data: perfData } = usePerformanceReport(activePerformanceReport);

    return useMemo(
        () =>
            perfData?.length
                ? [
                      Math.min(...perfData.map((data) => parseInt(data.id, 10))),
                      Math.max(...perfData.map((data) => parseInt(data.id, 10))),
                  ]
                : null,
        [perfData],
    );
};

// Not currently used
export const useReportMeta = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery<ReportMetaData, AxiosError>(['get-report-config', activeProfilerReport], fetchReportMeta);
};

export const useBufferPages = (operationId: number, address?: number | string, bufferType?: BufferType) => {
    return useQuery<BufferPage[], AxiosError>(
        ['get-buffer-pages', operationId, address, bufferType],
        () => fetchBufferPages(operationId, address, bufferType),
        { staleTime: Infinity },
    );
};

export const fetchTensors = async (): Promise<Tensor[]> => {
    try {
        const { data: tensorList } = await axiosInstance.get<Tensor[]>('/api/tensors', {
            maxRedirects: 1,
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

export const useTensors = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery<Tensor[], AxiosError>({
        queryFn: () => fetchTensors(),
        queryKey: ['get-tensors', activeProfilerReport],
        retry: false,
        staleTime: Infinity,
    });
};

export const useDevices = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery<DeviceData[], AxiosError>({
        queryFn: () => (activeProfilerReport !== null ? fetchDevices() : Promise.resolve([])),
        queryKey: ['get-devices', activeProfilerReport],
        retry: false,
        staleTime: Infinity,
    });
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
        staleTime: Infinity,
    });
};

export const useBuffers = (bufferType: BufferType, useRange?: boolean) => {
    const range = useAtomValue(selectedOperationRangeAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    const response = useQuery({
        queryFn: () => fetchBuffersByOperation(bufferType),
        queryKey: ['fetch-all-buffers', bufferType, activeProfilerReport],
        staleTime: Infinity,
    });

    return useMemo(() => {
        if (response.data && range && useRange) {
            response.data = response.data.filter((operation) => operation.id >= range[0] && operation.id <= range[1]);
        }

        return response;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range, response.data, useRange]);
};

export const useDeviceLog = () => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);

    return useQuery({
        queryFn: () => fetchDeviceLogRaw(),
        queryKey: ['get-device-log-raw', activePerformanceReport],
        staleTime: Infinity,
    });
};

export const usePerformanceReport = (name: string | null) => {
    const response = useQuery({
        queryFn: () => (name !== null ? fetchPerformanceReport(name) : Promise.resolve([])),
        queryKey: ['get-performance-report', name],
        enabled: name !== null,
    });

    return useMemo(() => {
        if (response.data) {
            const df: PerfTableRow[] = response.data
                .slice()
                .filter((r) => !r.op_code?.includes('(torch)') && !(r.op_code === ''));

            response.data = df;
        }

        return response;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [response.data]);
};

export const usePerformanceComparisonReport = (reportNames: string[] | null) => {
    const response = useQuery({
        queryFn: async () => {
            if (!reportNames) {
                return [];
            }

            const results = await Promise.all(reportNames.map((name) => fetchPerformanceReport(name)));

            return results;
        },
        queryKey: ['get-performance-comparison-report', reportNames],
        staleTime: Infinity,
        enabled: reportNames !== null,
    });

    return useMemo(() => {
        if (response.data) {
            const filtered = response.data.map((report: PerfTableRow[]) =>
                report.slice().filter((r) => !r.op_code?.includes('(torch)') && !(r.op_code === '')),
            );
            response.data = filtered;
        }
        return response;
    }, [response]);
};

export const useSession = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeNpe = useAtomValue(activeNpeOpTraceAtom);

    return useQuery({
        queryFn: () => fetchTabSession(),
        queryKey: ['get-session', activeProfilerReport, activePerformanceReport, activeNpe],
        initialData: null,
    });
};
export const useArchitecture = (arch: DeviceArchitecture): ChipDesign => {
    switch (arch) {
        case DeviceArchitecture.WORMHOLE:
            return archWormhole as ChipDesign;
        case DeviceArchitecture.BLACKHOLE:
            return archBlackhole as ChipDesign;
        default:
            // eslint-disable-next-line no-console
            console.error(`Unsupported arch: ${arch}`);
            return {} as ChipDesign;
    }
};

export const useGetTensorSizesById = (tensorIdList: number[]): { id: number; size: number }[] => {
    const { data: tensors } = useTensors();
    const buffersByOperation = useBuffers(BufferType.L1, false);
    return tensorIdList
        .map((tensorId) => {
            const tensor = tensors?.find((t) => t.id === tensorId);
            if (tensor) {
                const opid = tensor?.producers[0];
                const buffers = buffersByOperation.data?.find((b) => b.id === opid);
                const buffer = buffers?.buffers.find((b) => b.address === tensor.address);
                return { id: tensor.id, size: buffer?.size || null };
            }
            return null;
        })
        .filter((item) => item !== null) as { id: number; size: number }[];
};
export const useNodeType = (arch: DeviceArchitecture) => {
    const architecture = useArchitecture(arch);
    const cores = useMemo(() => {
        return architecture.functional_workers?.map((loc) => {
            return loc
                .split('-')
                .reverse()
                .map((l) => parseInt(l, 10));
        });
    }, [architecture]);

    const dram = useMemo(() => {
        return architecture.dram?.flat().map((loc) => {
            return loc
                .split('-')
                .reverse()
                .map((l) => parseInt(l, 10));
        });
    }, [architecture]);

    const eth = useMemo(() => {
        return architecture.eth?.flat().map((loc) => {
            return loc
                .split('-')
                .reverse()
                .map((l) => parseInt(l, 10));
        });
    }, [architecture]);

    const pcie = useMemo(() => {
        return architecture.pcie?.map((loc) => {
            return loc
                .split('-')
                .reverse()
                .map((l) => parseInt(l, 10));
        });
    }, [architecture]);

    return { architecture, cores, dram, eth, pcie };
};

export const PROFILER_FOLDER_QUERY_KEY = 'fetch-profiler-folder-list';

const fetchReportFolderList = async () => {
    const { data } = await axiosInstance.get('/api/profiler');

    return data;
};

export const deleteProfiler = async (report: string) => {
    const { data } = await axiosInstance.delete(`/api/profiler/${report}`);

    return data;
};

export const useReportFolderList = () => {
    return useQuery({
        queryFn: () => fetchReportFolderList(),
        queryKey: [PROFILER_FOLDER_QUERY_KEY],
        initialData: null,
    });
};

export const PERFORMANCE_FOLDER_QUERY_KEY = 'fetch-performance-folder-list';

const fetchPerfFolderList = async () => {
    const { data } = await axiosInstance.get('/api/performance');

    return data;
};

export const deletePerformance = async (report: string) => {
    const { data } = await axiosInstance.delete(`/api/performance/${report}`);

    return data;
};

export const usePerfFolderList = () => {
    return useQuery({
        queryFn: () => fetchPerfFolderList(),
        queryKey: [PERFORMANCE_FOLDER_QUERY_KEY],
        initialData: null,
    });
};
