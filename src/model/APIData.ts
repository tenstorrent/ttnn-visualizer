// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { RemoteConnection, RemoteFolder } from '../definitions/RemoteConnection';
import { ReportLocation } from '../definitions/Reports';
import { BufferMemoryLayout, MemoryConfig } from '../functions/parseMemoryConfig';
import { BufferType, StringBufferType } from './BufferType';

interface OperationError {
    operation_id: number;
    operation_name: string;
    error_type: string;
    error_message: string;
    stack_trace: string;
    timestamp: string;
}

export interface Operation {
    id: number;
    name: string;
    inputs: Tensor[];
    outputs: Tensor[];
    stack_trace: string;
    stack_trace_source_file_id: number | null;
    device_operations: Node[];
    operationFileIdentifier: string;
    error: OperationError | null;
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
    size: number | null;
}

export interface BufferData {
    operation_id: number;
    device_id: number;
    address: number;
    max_size_per_bank: number;
    buffer_type: BufferType;
    next_usage?: number;
}

export interface Buffer {
    address: number;
    buffer_type: BufferType;
    device_id: number;
    size: number;
    buffer_layout?: BufferMemoryLayout | null;
}

export interface OperationDetailsData extends Operation {
    id: number;
    buffers: BufferData[];
    buffersSummary: BufferData[];
    l1_sizes: number[];
}

export interface ActiveReport {
    profiler_name?: string;
    profiler_location?: ReportLocation;
    performance_name?: string;
    performance_location?: ReportLocation;
    npe_name?: string;
    npe_location?: ReportLocation;
    mlir_name?: string;
    mlir_location?: ReportLocation;
}

export interface Instance {
    instance_id: string;
    profiler_path: string | null;
    performance_path: string | null;
    npe_path: string | null;
    mlir_path: string | null;
    active_report: ActiveReport | null;
    remote_connection: RemoteConnection | null;
    remote_profiler_folder: RemoteFolder | null;
    remote_performance_folder: RemoteFolder | null;
}

export enum FileStatus {
    DOWNLOADING = 'DOWNLOADING',
    FAILED = 'FAILED',
    UPLOADING = 'UPLOADING',
    // Used for MLIR to indicate the file was uploaded but the server hasn't converted the file yet
    PROCESSING = 'PROCESSING',
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
    bytesTransferred?: number;
    bytesTotal?: number;
    currentFileSize?: number;
    timestamp?: string; // Optional, with default handled elsewhere if necessary
}

export const defaultOperation: OperationDetailsData = {
    id: 0,
    name: '',
    inputs: [],
    outputs: [],
    buffers: [],
    buffersSummary: [],
    l1_sizes: [],
    stack_trace: '',
    stack_trace_source_file_id: null,
    device_operations: [],
    operationFileIdentifier: '',
    error: null,
};

export const defaultTensorData: Tensor = {
    buffer_type: BufferType.L1,
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
    size: null,
};

export const defaultBuffer: BufferData = {
    operation_id: 0,
    device_id: 0,
    address: 0,
    max_size_per_bank: 0,
    buffer_type: BufferType.L1,
};

export interface Chunk {
    address: number;
    size: number;
    tensorId?: number;
    device_id?: number;
    lateDeallocation?: boolean;
}

export interface ColoredChunk extends Chunk {
    color: string | undefined;
}

export enum MarkerType {
    CB = 'CB',
    L1_SMALL = 'L1_SMALL',
    L1_START = 'L1_START',
}

export const MarkerTypeLabel: Record<MarkerType, string> = {
    [MarkerType.CB]: 'Circular Buffer',
    [MarkerType.L1_SMALL]: 'L1 SMALL',
    [MarkerType.L1_START]: 'L1 START',
};

export interface FragmentationEntry extends Chunk {
    markerType?: MarkerType | undefined;
    colorVariance?: number | undefined;
    empty?: boolean;
    largestEmpty?: boolean;
}

// export interface ReportMetaData {
//     cache_path: string;
//     model_cache_path: string;
//     tmp_dir: string;
//     enable_model_cache: boolean;
//     enable_fast_runtime_mode: boolean;
//     throw_exception_on_fallback: boolean;
//     enable_logging: boolean;
//     enable_graph_report: boolean;
//     enable_detailed_buffer_report: boolean;
//     enable_detailed_tensor_report: boolean;
//     enable_comparison_mode: boolean;
//     comparison_mode_pcc: number;
//     root_profiler_path: string;
//     profiler_name: string;
// }

export interface ReportMetadataResponse {
    schema_version?: string;
    capture_timestamp_ns?: string;
    total_duration_ns?: string;
}
export interface OperationDescription extends Operation {
    duration: number;
    arguments: {
        name: string;
        value: string;
        parsedValue: MemoryConfig | null;
    }[];
    processedConnections: DeviceOperationNode[];
    deviceOperationNameList: string[]; // List of device operation names. actual device ops only
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

export interface DeviceOperationParams {
    name: string;
    device_id?: number | string;
    inputs?: number;
}

export interface CircularBufferDeallocateParams {
    device_id: number;
}

interface BaseMemoryParams {
    address: string; // '1259520';
    device_id: number;
    num_cores: string; // '64';
    page_size: string; // '448';
    size: string; // '7340032';
    type: StringBufferType; // 'L1';
    exact_buffer_type: BufferType;
    layout: DeviceOperationLayoutTypes;
    buffer_type: BufferType;
}

export interface BufferDeallocateParams extends Omit<BaseMemoryParams, 'address'> {
    address?: string;
}

export interface DeviceTensorParams extends BaseMemoryParams {
    device_tensors: string; // '[{"address": 1374208, "device_id": 0, "mesh_device_id": 0}]';
    dtype: string;
    memory_config: string; // 'MemoryConfig(memory_layout=TensorMemoryLayout::HEIGHT_SHARDED,buffer_type=BufferType::L1,shard_spec=ShardSpec{grid=[{"start":{"x":0,"y":0},"end":{"x":5,"y":7}], shape=[224, 224], orientation=ShardOrientation::ROW_MAJOR},nd_shard_spec={"shard_shape":[224, 224],"grid":[{"start":{"x":0,"y":0},"end":{"x":5,"y":7}}],"orientation":"ShardOrientation::ROW_MAJOR","shard_distribution_strategy":"ShardDistributionStrategy::ROUND_ROBIN_1D"},created_with_nd_shard_spec=0)';
    shape: string; // 'Shape([16, 3, 224, 224])';
    tensor_id: number; // '0';
}

interface BufferAllocateParams extends BaseMemoryParams {
    max_size_per_bank?: string; // '114688';
    derivedDeviceId?: number[];
}

interface CircularBufferAllocateParams extends BaseMemoryParams {
    core_range_set: string;
    // tt-metal emits this as a JSON string `'0'` / `'1'` in the captured-graph
    // blob (verified against the `resnet50_main_jun10_2110` raw
    // `graph_capture.json`, not just the DB round-trip). The stale `'false'`
    // comment on this field was misleading: the values are integer-valued
    // strings, not boolean strings. `'1'` means the CB is a kernel-side view
    // bound to an existing L1 sharded buffer (the tensor) rather than a fresh
    // allocation. Optional because older reports captured before the field was
    // added won't include it; the renderer falls back to treating the CB as a
    // standalone allocation in that case. See #1651.
    globally_allocated?: '0' | '1';
    allocateOperationId: number;
    allocateOperationName: string;
}

export interface BaseNode<T extends NodeType, P> {
    connections: number[];
    id: number;
    node_type: T;
    params: P;
    inputs: Node[]; // tree specific
    outputs: Node[]; // tree specific
    operation?: DeviceOperationNode;
    buffer?: BufferNode[];
    allocation?: BufferAllocateNode;
    stacking_level: number;
}

export interface DeviceOperationNode extends BaseNode<NodeType.function_start, DeviceOperationParams> {
    input_tensors: number[];
    arguments: string[];
    stack_trace: string[];
}

export type CaptureStartNode = BaseNode<NodeType.capture_start, DeviceOperationParams>;
export type CaptureEndNode = BaseNode<NodeType.capture_end, DeviceOperationParams>;
export type DeviceOperationNodeEnd = BaseNode<NodeType.function_end, DeviceOperationParams>;

export type BufferNode = BaseNode<NodeType.buffer, BufferAllocateParams>;
export type BufferAllocateNode = BaseNode<NodeType.buffer_allocate, BufferAllocateParams>;
export type BufferDeallocateNode = BaseNode<NodeType.buffer_deallocate, BufferDeallocateParams>;

export type CircularBufferAllocateNode = BaseNode<NodeType.circular_buffer_allocate, CircularBufferAllocateParams>;
export type CircularBufferDeallocateAllNode = BaseNode<
    NodeType.circular_buffer_deallocate_all,
    CircularBufferDeallocateParams
>;

export type TensorNode = BaseNode<NodeType.tensor, DeviceTensorParams>;

export type Node =
    | CaptureStartNode
    | CaptureEndNode
    | DeviceOperationNode
    | DeviceOperationNodeEnd
    | BufferNode
    | BufferAllocateNode
    | BufferDeallocateNode
    | CircularBufferAllocateNode
    | CircularBufferDeallocateAllNode
    | TensorNode;

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
    type: StringBufferType;
}

export interface BufferChunk {
    operation_id: number;
    device_id: number;
    address: number;
    bank_id: number;
    core_x: number;
    core_y: number;
    chunk_address: number;
    chunk_size: number;
    page_size: number;
    num_pages: number;
    buffer_type: BufferType;
    rank?: number;
    id: string;
}

/**
 * Render-side projection of a ``BufferChunk`` with the tensor association
 * and palette colour resolved by the consuming component.
 *
 * Lives outside the API/cache shape on purpose: ``tensor_id`` and ``color``
 * are derived from the caller's ``tensorByAddress`` map (or fallback hues),
 * so they're per-render concerns and don't belong on the React Query cache
 * entry. Keeping them off ``BufferChunk`` also prevents accidental in-place
 * mutation of cached objects when more than one consumer of
 * ``useBufferChunks`` shows up later.
 */
export interface DecoratedBufferChunk extends BufferChunk {
    tensor_id?: number;
    color: string;
}

/**
 * Legacy raw row from a backend that has not yet been updated to return
 * pre-aggregated chunks. The FE adapter in ``fetchBufferChunks`` collapses
 * an array of these into ``BufferChunk[]`` so downstream code never sees
 * the old shape.
 */
export interface LegacyBufferPage {
    operation_id: number;
    device_id: number;
    address: number;
    bank_id: number;
    core_x: number;
    core_y: number;
    page_index: number;
    page_address: number;
    page_size: number;
    buffer_type: BufferType;
    rank?: number;
    id?: string;
}

export interface BuffersByOperation {
    buffers: Buffer[];
    id: number;
    name: string;
}

export interface DeviceInfo {
    address_at_first_l1_bank: number;
    address_at_first_l1_cb_buffer: number;
    cb_limit: number;
    device_id: number;
    l1_bank_size: number;
    l1_num_banks: number;
    num_banks_per_storage_core: number;
    num_compute_cores: number;
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

export interface PerformanceLog {
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
    zone_name: string;
    zone_phase: 'begin' | 'end';
}
