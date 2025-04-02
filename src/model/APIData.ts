// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { RemoteConnection, RemoteFolder } from '../definitions/RemoteConnection';
import { MemoryConfig } from '../functions/parseMemoryConfig';
import { BufferType } from './BufferType';

export interface Operation {
    id: number;
    name: string;
    inputs: Tensor[];
    outputs: Tensor[];
    stack_trace: string;
    device_operations: Node[];
    operationFileIdentifier: string;
}

export interface Tensor {
    address: number | null;
    id: number;
    buffer_type: BufferType | null;
    producers: number[];
    consumers: number[];
    producerNames: string[];
    consumerNames: string[];
    shape: string;
    dtype: string;
    layout: string;
    memory_config: MemoryConfig | null;
    device_id: number | null;
    producerOperation?: Operation;
    operationIdentifier?: string;
    comparison: {
        global: {
            actual_pcc: number;
            desired_pcc: number;
            golden_tensor_id: number;
            matches: number;
            tensor_id: number;
        };
        local: {
            actual_pcc: number;
            desired_pcc: number;
            golden_tensor_id: number;
            matches: number;
            tensor_id: number;
        };
    } | null;
    io: 'input' | 'output' | null;
}

export interface BufferData {
    operation_id: number;
    device_id: number;
    address: number;
    max_size_per_bank: number;
    buffer_type: number;
    next_usage?: number;
}

export interface Buffer {
    address: number;
    buffer_type: number;
    device_id: number;
    size: number;
}

export interface OperationDetailsData extends Operation {
    id: number;
    buffers: BufferData[];
    buffersSummary: BufferData[];
    l1_sizes: number[];
}

export interface TabSession {
    active_report?: { profile_name?: string; report_name?: string; npe_name?: string };
    remote_connection?: RemoteConnection;
    remote_folder?: RemoteFolder;
}

export enum FileStatus {
    DOWNLOADING = 'DOWNLOADING',
    FAILED = 'FAILED',
    UPLOADING = 'UPLOADING',
    COMPRESSING = 'COMPRESSING',
    FINISHED = 'FINISHED',
    STARTED = 'STARTED',
    INACTIVE = 'INACTIVE',
}

// TypeScript Interface with underscored keys to match the backend data
export interface FileProgress {
    currentFileName: string;
    numberOfFiles: number;
    percentOfCurrent: number;
    finishedFiles: number;
    status: FileStatus; // Use the FileStatus enum
    timestamp?: string; // Optional, with default handled elsewhere if necessary
}

// TODO: we may want to revisit the 'default' portion for the variable name
export const defaultOperationDetailsData: OperationDetailsData = {
    id: 0,
    name: '',
    inputs: [],
    outputs: [],
    buffers: [],
    buffersSummary: [],
    l1_sizes: [],
    stack_trace: '',
    device_operations: [],
    operationFileIdentifier: '',
};

export const defaultTensorData: Tensor = {
    buffer_type: 0,
    id: 0,
    shape: '',
    dtype: '',
    layout: '',
    memory_config: null,
    device_id: 0,
    io: null,
    address: null,
    producers: [],
    consumers: [],
    producerNames: [],
    consumerNames: [],
    comparison: null,
};

export const defaultBuffer: BufferData = {
    operation_id: 0,
    device_id: 0,
    address: 0,
    max_size_per_bank: 0,
    buffer_type: 0,
};

export interface Chunk {
    address: number;
    size: number;
    tensorId?: number;
    device_id?: number;
}

export interface ColoredChunk extends Chunk {
    color: string | undefined;
}

export interface FragmentationEntry extends Chunk {
    empty?: boolean;
    largestEmpty?: boolean;
    bufferType?: 'CB' | 'L1_SMALL' | undefined;
    colorVariance?: number | undefined;
}

export interface ReportMetaData {
    cache_path: string;
    model_cache_path: string;
    tmp_dir: string;
    enable_model_cache: boolean;
    enable_fast_runtime_mode: boolean;
    throw_exception_on_fallback: boolean;
    enable_logging: boolean;
    enable_graph_report: boolean;
    enable_detailed_buffer_report: boolean;
    enable_detailed_tensor_report: boolean;
    enable_comparison_mode: boolean;
    comparison_mode_pcc: number;
    root_report_path: string;
    report_name: string;
}

export interface OperationDescription extends Operation {
    duration: number;
    arguments: {
        name: string;
        value: string;
        parsedValue: MemoryConfig | null;
    }[];
}

export enum NodeType {
    capture_start = 'capture_start',
    capture_end = 'capture_end',
    function_start = 'function_start',
    function_end = 'function_end',
    buffer = 'buffer',
    buffer_allocate = 'buffer_allocate',
    buffer_deallocate = 'buffer_deallocate',
    circular_buffer_allocate = 'circular_buffer_allocate',
    circular_buffer_deallocate_all = 'circular_buffer_deallocate_all',
    tensor = 'tensor',
}

export enum DeviceOperationLayoutTypes {
    INTERLEAVED = 'INTERLEAVED',
    SINGLE_BANK = 'SINGLE_BANK',
    HEIGHT_SHARDED = 'HEIGHT_SHARDED',
    ROW_MAJOR = 'ROW_MAJOR',
    TILE = 'TILE',
}

export enum DeviceOperationTypes {
    L1 = 'L1',
    DRAM = 'DRAM',
}

interface DeviceOperationParams {
    inputs: number;
    name: string;
    tensor_id: number;
    shape: string;
    address: string;
    layout: DeviceOperationLayoutTypes;
    size: string;
    type: DeviceOperationTypes;
    /** only for CBs */
    core_range_set: string;
    /** only for buffers */
    num_cores: string;
    device_id?: number | string;
    derived_device_id?: number[];
}

export interface Node {
    connections: number[];
    id: number;
    node_type: NodeType;
    params: DeviceOperationParams;
    inputs: Node[];
    outputs: Node[];
    operation?: Node;
    buffer?: Node[];
    allocation?: Node;
}

export interface DeviceOperation {
    id: number;
    name: string;
    cbList: CircularBuffer[];
    bufferList: TensorBuffer[];
    deallocateCBs: boolean;
    deallocateBuffers: boolean;
    tensor?: { shape: string; id: number };
    events: NodeType[];
}

export interface CircularBuffer extends Chunk {
    num_cores: number;
    core_range_set: string;
    colorVariance?: number | undefined;
}

export interface TensorBuffer extends Chunk {
    layout: DeviceOperationLayoutTypes;
    type: DeviceOperationTypes;
}

export interface BufferPage {
    address: number;
    bank_id: number;
    buffer_type: number;
    core_x: number;
    core_y: number;
    device_id: number;
    operation_id: number;
    page_address: number;
    page_index: number;
    page_size: number;
    id: string;

    tensor_id?: number;
    color?: string;
}
