// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import axios, { AxiosError } from 'axios';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useAtomValue } from 'jotai';
import { NumberRange } from '@blueprintjs/core';
import Ajv from 'ajv';
import axiosInstance from '../libs/axiosInstance';
import {
    Buffer,
    BufferData,
    BufferPage,
    BuffersByOperation,
    DeviceInfo,
    Instance,
    NodeType,
    Operation,
    OperationDescription,
    OperationDetailsData,
    ReportMetaData,
    Tensor,
    TensorWithSize,
    defaultBuffer,
    defaultOperationDetailsData,
    defaultTensorData,
} from '../model/APIData';
import { BufferType } from '../model/BufferType';
import parseMemoryConfig, { MemoryConfig, memoryConfigPattern } from '../functions/parseMemoryConfig';
import { PerfTableRow } from '../definitions/PerfTable';
import { StackedPerfRow } from '../definitions/StackedPerfTable';
import { isDeviceOperation } from '../functions/filterOperations';
import {
    activeNpeOpTraceAtom,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    comparisonPerformanceReportListAtom,
    filterBySignpostAtom,
    hideHostOpsAtom,
    mergeDevicesAtom,
    selectedOperationRangeAtom,
    stackByIn0Atom,
} from '../store/app';
import archWormhole from '../assets/data/arch-wormhole.json';
import archBlackhole from '../assets/data/arch-blackhole.json';
import { DeviceArchitecture } from '../definitions/DeviceArchitecture';
import { NPEData, NPEManifestEntry } from '../model/NPEModel';
import { ChipDesign, ClusterModel } from '../model/ClusterModel';
import npeManifestSchema from '../schemas/npe-manifest.schema.json';
import createToastNotification from '../functions/createToastNotification';
import { normaliseReportFolder } from '../functions/validateReportFolder';
import { Signpost } from '../functions/perfFunctions';
import { TensorDeallocationReport, TensorsByOperationByAddress } from '../model/BufferSummary';
import { L1_DEFAULT_MEMORY_SIZE } from '../definitions/L1MemorySize';

const EMPTY_PERF_RETURN = { report: [], stacked_report: [], signposts: [] };

const parseFileOperationIdentifier = (stackTrace: string): string => {
    const regex = /File\s+"(?:.+\/)?([^/]+)",\s+line\s+(\d+)/;
    const match = stackTrace.match(regex);

    if (match) {
        return `${match[1]}:${match[2]}`;
    }

    return '';
};

export const fetchInstance = async (): Promise<Instance | null> => {
    // eslint-disable-next-line promise/valid-params
    const response = await axiosInstance.get<Instance>('/api/instance').catch();
    return response?.data;
};

export const updateInstance = async (payload: Partial<Instance>): Promise<Instance | null> => {
    // eslint-disable-next-line promise/valid-params
    const response = await axiosInstance.put<Instance>('/api/instance', payload).catch();
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

const MAX_RETRY_COUNT = 2;

const fetchOperations = async (): Promise<OperationDescription[]> => {
    const tensorList: Map<number, Tensor> = new Map<number, Tensor>();
    let response = await axiosInstance.get<OperationDescription[]>('/api/operations');
    let operationList = response.data;
    let retryCount = 0;

    const getDeviceOperationNameList = (operation: OperationDescription) => {
        return operation.device_operations
            .filter((op) => {
                return op.node_type === NodeType.function_start && isDeviceOperation(op.params.name);
            })
            .map((op) => op.params.name);
    };

    // TODO: Figure out why we sometimes get a string back instead of an array so we don't need this hack
    while (!Array.isArray(operationList) && retryCount < MAX_RETRY_COUNT) {
        // eslint-disable-next-line no-console
        console.info('Data is not a JSON array, refetching operations list');
        // eslint-disable-next-line no-await-in-loop
        response = await axiosInstance.get<OperationDescription[]>('/api/operations');
        operationList = response.data;
        retryCount++;
    }

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
            deviceOperationNameList: getDeviceOperationNameList(operation),
        } as OperationDescription;
    });
};

const fetchBuffersByOperation = async (bufferType: BufferType | null): Promise<BuffersByOperation[]> => {
    const params = {
        buffer_type: bufferType,
    };

    const { data: buffers } = await axiosInstance.get<BuffersByOperation[]>('/api/operation-buffers', {
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
        queryKey: ['fetch-all-buffers', bufferType, activeProfilerReport?.path],
        staleTime: Infinity,
    });
};

export const useGetUniqueDeviceOperationsList = (): string[] => {
    const { data: operations } = useOperationsList();

    return useMemo(() => {
        if (!operations || operations.length === 0) {
            return [];
        }

        const deviceOperationSet = new Set<string>();

        for (const operation of operations) {
            for (const deviceOperation of operation.deviceOperationNameList) {
                deviceOperationSet.add(deviceOperation);
            }
        }

        return Array.from(deviceOperationSet);
    }, [operations]);
};

/**
 * @description returns start address of the first L1 small buffer. this is interim solution until BE can collect to devices table
 */
export const useGetL1SmallMarker = (): number => {
    const { data: buffers } = useGetAllBuffers(BufferType.L1_SMALL);

    return useMemo(() => {
        const addresses = buffers?.map((buffer) => {
            return buffer.address;
        }) || [L1_DEFAULT_MEMORY_SIZE];

        let min = Infinity;
        for (let i = 0; i < addresses.length; i++) {
            if (addresses[i] < min) {
                min = addresses[i];
            }
        }
        return min === Infinity ? L1_DEFAULT_MEMORY_SIZE : min;
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
    return useQuery<BuffersByOperation, AxiosError>({
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

const fetchDevices = async (reportName: string) => {
    const { data: meta } = await axiosInstance.get<DeviceInfo[]>('/api/devices');

    if (meta.length === 0) {
        // TODO: Report Name here is actually the path because that's what we store in the atom - atom should store ReportFolder object
        createToastNotification('Data integrity warning: No device information provided.', `/${reportName}`, true);
    }

    return [...new Map(meta.map((device) => [device.device_id, device])).values()];
};

export interface PerformanceReportResponse {
    report: PerfTableRow[];
    stacked_report: StackedPerfRow[];
    signposts?: Signpost[];
}

const fetchPerformanceReport = async (
    name: string | null,
    stackByIn0: boolean,
    startSignpost: Signpost | null,
    endSignpost: Signpost | null,
    hideHostOps: boolean,
    mergeDevices: boolean,
) => {
    const { data } = await axiosInstance.get<PerformanceReportResponse>(`/api/performance/perf-results/report`, {
        params: {
            name,
            stack_by_in0: stackByIn0,
            start_signpost: startSignpost?.op_code,
            end_signpost: endSignpost?.op_code,
            hide_host_ops: hideHostOps,
            merge_devices: mergeDevices,
        },
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
    architecture: DeviceArchitecture | null;
    frequency: number | null;
    max_cores: number | null;
}

const fetchDeviceMeta = async (name: string | null) => {
    const { data } = await axiosInstance.get<MetaData>('/api/performance/device-log/meta', {
        params: { name },
    });

    return data;
};

const fetchClusterDescription = async (): Promise<ClusterModel> => {
    const { data } = await axiosInstance.get<ClusterModel>('/api/cluster-descriptor');
    return data;
};

export const useGetClusterDescription = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery({
        queryFn: () => fetchClusterDescription(),
        queryKey: ['get-cluster-description', activeProfilerReport?.path],
        initialData: null,
        retry: false,
    });
};

export const useOperationsList = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    return useQuery<OperationDescription[], AxiosError>({
        queryFn: () => (activeProfilerReport !== null ? fetchOperations() : Promise.resolve([])),
        queryKey: ['get-operations', activeProfilerReport?.path],
        retry: false,
        staleTime: Infinity,
    });
};

export const useOperationListRange = (): NumberRange | null => {
    const response = useOperationsList();

    return useMemo(
        () => (response?.data?.length ? [response.data?.[0].id, response.data?.[response.data.length - 1].id] : null),
        // TODO: this used to rely on response.isLoading... which iis an invalid dependency. will have to wait for david to come back.
        // this fixes #613 https://github.com/tenstorrent/ttnn-visualizer/issues/613
        [response.data],
    );
};

const fetchNpeOpTrace = async () => {
    const response = await axiosInstance.get<NPEData>('/api/npe');
    return response?.data;
};

export const useNpe = (fileName: string | null) => {
    return useQuery<NPEData, AxiosError>({
        queryFn: () => fetchNpeOpTrace(),
        queryKey: ['fetch-npe', fileName],
        retry: false,
        staleTime: 30000,
        enabled: fileName !== null,
    });
};

export const useOperationDetails = (operationId: number | null) => {
    const { data: operations } = useOperationsList();

    // Memoize the operation lookup
    const operation = useMemo(
        () => operations?.find((_operation) => _operation.id === operationId) || null,
        [operations, operationId],
    );

    // Memoized function for fetching operation details
    const fetchDetails = useCallback(() => fetchOperationDetails(operationId), [operationId]);

    const operationDetails = useQuery<OperationDetailsData>({
        queryFn: () => fetchDetails(),
        queryKey: ['get-operation-detail', operationId],
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
                    return { id: operation.id, name: operation.name, ops: operation.deviceOperationNameList };
                })
                .filter((data) => {
                    return data.ops.length > 0;
                }) || []
        );
    }, [operations]);
};

export interface DeviceOperationMapping {
    name: string;
    id: number;
    operationName: string;
    perfData?: PerfTableRow;
}

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

const useProxyPerformanceReport = (): PerformanceReportResponse => {
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const response = usePerformanceReport(activePerformanceReport?.reportName || null);

    return useMemo(() => {
        if (!response.data) {
            return EMPTY_PERF_RETURN;
        }
        return response.data;
    }, [response.data]);
};

export const useGetDeviceOperationListPerf = () => {
    const deviceOperations: DeviceOperationMapping[] = useGetDeviceOperationsList();
    const data = useProxyPerformanceReport();

    return useMemo(() => {
        const isValid = deviceOperations.every((deviceOperation, index) => {
            const perfData = data.report[index];

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
    const { data: perfData } = usePerformanceReport(activePerformanceReport?.reportName || null);

    return useMemo(
        () =>
            perfData?.report?.length
                ? [
                      Math.min(...perfData.report.map((data) => parseInt(data.id, 10))),
                      Math.max(...perfData.report.map((data) => parseInt(data.id, 10))),
                  ]
                : null,
        [perfData],
    );
};

// Not currently used
export const useReportMeta = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery<ReportMetaData, AxiosError>({
        queryKey: ['get-report-config', activeProfilerReport?.path],
        queryFn: () => fetchReportMeta(),
    });
};

export const useBufferPages = (operationId: number, address?: number | string, bufferType?: BufferType) => {
    return useQuery<BufferPage[], AxiosError>({
        queryKey: ['get-buffer-pages', operationId, address, bufferType],
        queryFn: () => fetchBufferPages(operationId, address, bufferType),
        staleTime: Infinity,
    });
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
        queryKey: ['get-tensors', activeProfilerReport?.path],
        retry: false,
        staleTime: Infinity,
    });
};

export const useDevices = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    return useQuery<DeviceInfo[], AxiosError>({
        queryFn: () => (activeProfilerReport !== null ? fetchDevices(activeProfilerReport?.path) : Promise.resolve([])),
        queryKey: ['get-devices', activeProfilerReport?.path],
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
    return useQuery<BufferData, AxiosError>({
        queryKey: [queryKey],
        queryFn: () => fetchNextUseOfBuffer(address, consumers),
        retry: false,
        staleTime: Infinity,
    });
};

export const useBuffers = (bufferType: BufferType | null, useRange?: boolean) => {
    const range = useAtomValue(selectedOperationRangeAtom);
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);

    const response = useQuery<BuffersByOperation[], AxiosError>({
        queryKey: ['fetch-all-buffers', bufferType, activeProfilerReport],
        enabled: activeProfilerReport !== null,
        retry: false,
        staleTime: Infinity,
        queryFn: async () => {
            if (activeProfilerReport === null) {
                await Promise.resolve([]);
            }
            const data = await fetchBuffersByOperation(bufferType);
            // @ts-expect-error will happen with extra large data sets where we get a string instead of an array
            if (data === '' || !Array.isArray(data)) {
                throw new AxiosError(
                    `Invalid response: data is invalid or too large to render."`,
                    'ERR_INVALID_RESPONSE',
                );
            }

            return data;
        },
    });

    return useMemo(() => {
        if (response.data && range && useRange) {
            response.data = response.data.filter((operation) => operation.id >= range[0] && operation.id <= range[1]);
        }

        return response;
    }, [range, response, useRange]);
};

export const usePerfMeta = (name?: string | null) => {
    const key = name || null;
    return useQuery({
        queryFn: () => fetchDeviceMeta(key),
        queryKey: ['get-device-log-meta', key],
        staleTime: Infinity,
    });
};

export const usePerformanceReport = (name: string | null) => {
    const [startSignpost, endSignpost] = useAtomValue(filterBySignpostAtom);
    const stackByIn0 = useAtomValue(stackByIn0Atom);
    const hideHostOps = useAtomValue(hideHostOpsAtom);
    const mergeDevices = useAtomValue(mergeDevicesAtom);

    const response = useQuery<PerformanceReportResponse, AxiosError>({
        queryFn: () =>
            name !== null
                ? fetchPerformanceReport(name, stackByIn0, startSignpost, endSignpost, hideHostOps, mergeDevices)
                : Promise.resolve(EMPTY_PERF_RETURN),
        queryKey: [
            'get-performance-report',
            name,
            `stackByIn0:${stackByIn0 ? 'true' : 'false'}`,
            `startSignpost:${startSignpost ? `${startSignpost.id}${startSignpost.op_code}` : null}`,
            `endSignpost:${endSignpost ? `${endSignpost.id}${endSignpost.op_code}` : null}`,
            `hideHostOps:${hideHostOps ? 'true' : 'false'}`,
            `mergeDevices:${mergeDevices ? 'true' : 'false'}`,
        ],
        enabled: name !== null,
        retry: false, // TODO: Added to force not retrying on 4xx errors, might need to handle differently
        staleTime: Infinity,
    });

    return response;
};

export const usePerformanceComparisonReport = () => {
    const rawReportNames = useAtomValue(comparisonPerformanceReportListAtom);
    const stackByIn0 = useAtomValue(stackByIn0Atom);
    const [startSignpost, endSignpost] = useAtomValue(filterBySignpostAtom);
    const hideHostOps = useAtomValue(hideHostOpsAtom);
    const mergeDevices = useAtomValue(mergeDevicesAtom);

    const reportNames = useMemo(() => {
        return Array.isArray(rawReportNames) ? [...rawReportNames] : rawReportNames;
    }, [rawReportNames]);

    const response = useQuery<PerformanceReportResponse[], AxiosError>({
        queryFn: async () => {
            if (!reportNames || !Array.isArray(reportNames) || reportNames.length === 0) {
                return [];
            }

            const results = await Promise.all(
                reportNames.map((name) =>
                    fetchPerformanceReport(name, stackByIn0, startSignpost, endSignpost, hideHostOps, mergeDevices),
                ),
            );

            return results;
        },
        queryKey: [
            'get-performance-comparison-report',
            reportNames,
            `stackByIn0:${stackByIn0 ? 'true' : 'false'}`,
            `startSignpost:${startSignpost ? `${startSignpost.id}${startSignpost.op_code}` : null}`,
            `endSignpost:${endSignpost ? `${endSignpost.id}${endSignpost.op_code}` : null}`,
            `hideHostOps:${hideHostOps ? 'true' : 'false'}`,
            `mergeDevices:${mergeDevices ? 'true' : 'false'}`,
        ],
        staleTime: Infinity,
        enabled: !!reportNames,
    });

    return response;
};

export const useInstance = () => {
    const activeProfilerReport = useAtomValue(activeProfilerReportAtom);
    const activePerformanceReport = useAtomValue(activePerformanceReportAtom);
    const activeNpe = useAtomValue(activeNpeOpTraceAtom);

    return useQuery({
        queryFn: () => fetchInstance(),
        queryKey: ['fetch-instance', activeProfilerReport?.path, activePerformanceReport?.path, activeNpe],
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

    return data.map(normaliseReportFolder);
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

export const useTensorListById = () => {
    const { data: buffersByOperation } = useBuffers(null);
    const { data: tensors } = useTensors();
    return useMemo(() => {
        const bufferMapByOperation = new Map<number, Buffer[]>();
        buffersByOperation?.forEach((operationBuffers) => {
            bufferMapByOperation.set(operationBuffers.id, operationBuffers.buffers);
        });
        const tensorListById = new Map<number, TensorWithSize>();
        if (!tensors || !buffersByOperation) {
            return tensorListById;
        }

        for (const tensor of tensors) {
            if (tensor.address !== null && tensor.address !== undefined) {
                if (tensor.id != null && !tensorListById.has(tensor.id)) {
                    const bufferlist = bufferMapByOperation.get(tensor.producers[0])!;
                    tensorListById.set(tensor.id, {
                        ...tensor,
                        size: bufferlist?.find((buffer) => buffer.address === tensor.address)?.size || 0,
                    });
                }
            }
        }

        return tensorListById;
    }, [buffersByOperation, tensors]);
    // const data = useCreateTensorsByOperationByIdList();
    // return useMemo(() => {
    //     const tensorListById = new Map<number, TensorWithSize>();
    //     for (const tensorsById of data.values()) {
    //         for (const [tensorId, tensor] of tensorsById) {
    //             if (!tensorListById.has(tensorId) && tensorId != null) {
    //                 tensorListById.set(tensorId, tensor);
    //             }
    //         }
    //     }
    //     return tensorListById;
    // }, [data]);
};

export const useCreateTensorsByOperationByIdList = (bufferType: BufferType = BufferType.L1) => {
    const { data: buffersByOperation } = useBuffers(bufferType);
    const { data: operations } = useOperationsList();

    const tensorsByOperationByAddress: TensorsByOperationByAddress = new Map();
    const uniqueBuffersByOperationList = useMemo(() => {
        return buffersByOperation?.map((operation) => {
            const uniqueBuffers: Map<number, Buffer> = new Map<number, Buffer>();
            operation.buffers.forEach((buffer) => {
                const { address, size } = buffer;
                if (address) {
                    const existingBuffer = uniqueBuffers.get(address);
                    if (!existingBuffer || size > existingBuffer.size) {
                        uniqueBuffers.set(address, buffer);
                    }
                }
            });
            return {
                ...operation,
                buffers: Array.from(uniqueBuffers.values()),
            };
        });
    }, [buffersByOperation]);

    if (!operations || !buffersByOperation) {
        return tensorsByOperationByAddress;
    }

    const buffersByOpId = new Map<number, Buffer[]>();
    uniqueBuffersByOperationList?.forEach((op) => {
        buffersByOpId.set(op.id, op.buffers);
    });

    const latestTensorByAddress = new Map<number, Tensor>();

    for (const op of operations) {
        if (op.inputs) {
            for (const t of op.inputs) {
                if (t && t.address !== null && t.address !== undefined) {
                    latestTensorByAddress.set(t.address, t);
                }
            }
        }
        if (op.outputs) {
            for (const t of op.outputs) {
                if (t && t.address !== null && t.address !== undefined) {
                    latestTensorByAddress.set(t.address, t);
                }
            }
        }

        const buffers = buffersByOpId.get(op.id);
        if (!buffers?.length) {
            tensorsByOperationByAddress.set(op.id, new Map());
            // eslint-disable-next-line no-continue
            continue;
        }

        const tensorsByBufferAddress = new Map<number, TensorWithSize>();

        for (const buffer of buffers) {
            const addr = buffer.address;
            if (addr === null || addr === undefined) {
                // eslint-disable-next-line no-continue
                continue;
            }

            const tensor = latestTensorByAddress.get(addr);
            if (tensor) {
                tensorsByBufferAddress.set(addr, {
                    ...tensor,
                    buffer_type: buffer.buffer_type,
                    size: buffer.size,
                });
            }
        }

        tensorsByOperationByAddress.set(op.id, tensorsByBufferAddress);
    }

    return tensorsByOperationByAddress;
};

export const useGetTensorDeallocationReportByOperation = () => {
    const tensorListByOperation = useCreateTensorsByOperationByIdList();
    const { data: operations } = useOperationsList();

    const operationsById = useMemo(() => {
        const map = new Map<number, Operation>();
        operations?.forEach((operation) => {
            map.set(operation.id, operation);
        });
        return map;
    }, [operations]);

    return useMemo(() => {
        const getLastValidConsumer = (consumers: number[]) => {
            const list = [...consumers];
            while (list && list.length > 0) {
                const lastConsumerOperationId = list.sort().pop() || -1;
                const lastConsumerName = operationsById.get(lastConsumerOperationId)?.name || '';

                if (lastConsumerOperationId > -1 && !lastConsumerName.includes('ttnn.deallocate')) {
                    return { lastConsumerOperationId, lastConsumerName };
                }
            }
            return { lastConsumerName: '', lastConsumerOperationId: -1 };
        };
        const lateDeallocationsByOperation = new Map<number, TensorDeallocationReport[]>();
        const nonDeallocatedTensorListById = new Map<number, TensorDeallocationReport>();
        tensorListByOperation.forEach((tensorsMap, operationId) => {
            tensorsMap.forEach((tensor, address) => {
                if (tensor.id && tensor.consumers && tensor.consumers.length > 0) {
                    const { lastConsumerOperationId, lastConsumerName } = getLastValidConsumer(tensor.consumers);
                    if (lastConsumerOperationId !== null && lastConsumerOperationId < operationId) {
                        if (!lateDeallocationsByOperation.has(operationId)) {
                            lateDeallocationsByOperation.set(operationId, []);
                        }
                        const list: TensorDeallocationReport[] = lateDeallocationsByOperation.get(operationId)!;
                        const tensorInfo: TensorDeallocationReport = {
                            id: tensor.id,
                            address,
                            consumerName: lastConsumerName,
                            lastConsumerOperationId,
                            lastOperationId: operationId,
                        };
                        list.push(tensorInfo);
                        lateDeallocationsByOperation.set(operationId, list);
                        nonDeallocatedTensorListById.set(tensor.id, tensorInfo);
                    }
                }
            });
        });

        return { lateDeallocationsByOperation, nonDeallocatedTensorList: nonDeallocatedTensorListById };
    }, [operationsById, tensorListByOperation]);
};
