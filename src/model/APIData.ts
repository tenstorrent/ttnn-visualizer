// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Operation, Tensor } from './Graph';
import { RemoteConnection, RemoteFolder } from '../definitions/RemoteConnection';

export interface TensorData extends Tensor {
    shape: string;
    dtype: string;
    layout: string;
    memory_config: string | null;
    device_id: number | null;
    io: 'input' | 'output' | null; // TODO: validate usefulness in the future
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
    inputs: TensorData[];
    outputs: TensorData[];
    buffers: BufferData[];
    l1_sizes: number[];
    stack_trace: string;
    device_operations: Node[];
}

export interface TabSession {
    active_report?: { name: string };
    remote_connection?: RemoteConnection;
    remote_folder?: RemoteFolder;
}

export enum FileStatus {
    DOWNLOADING = 'DOWNLOADING',
    FAILED = 'FAILED',
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
    l1_sizes: [],
    stack_trace: '',
    device_operations: [],
};

export const defaultTensorData: TensorData = {
    buffer_type: 0,
    id: 0,
    shape: '',
    dtype: '',
    layout: '',
    memory_config: '',
    device_id: 0,
    io: null,
    address: null,
    producers: [],
    consumers: [],
    producerNames: [],
    consumerNames: [],
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
}
export interface ColoredChunk extends Chunk {
    color: string | undefined;
}

export interface FragmentationEntry extends Chunk {
    empty?: boolean;
    largestEmpty?: boolean;
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
    arguments: { name: string; value: string }[];
    device_operations: Node[];
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
    core_range_set: string;
}

export interface Node {
    connections: number[];
    id: number;
    node_type: NodeType;
    params: DeviceOperationParams;
}

export interface DeviceOperation {
    name: string;
    cbList: CircularBuffer[];
    bufferList: TensorBuffer[];
    deallocateCBs: boolean;
    deallocateBuffers: boolean;
    indentLevel: number; // device ops nesting level indicator
    colorVariance?: number | undefined;
}

export interface CircularBuffer extends Chunk {
    core_range_set: string;
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
