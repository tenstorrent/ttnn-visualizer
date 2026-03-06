import { DeviceOperationLayoutTypes, NodeType, StringBufferType } from './APIData';
import { BufferType } from './BufferType';

interface GraphMarkerParams {
    name?: string;
}

interface BufferParams {
    inputs: number;
    name: string;
    tensor_id: number;
    shape: string;
    address: string;
    layout: DeviceOperationLayoutTypes;
    size: string;
    type: StringBufferType;
    arguments: string[];
    num_cores?: string;
    device_id?: number | string;
    derived_device_id?: number[];
}

interface CircularBufferParams extends Omit<BufferParams, 'num_cores'> {
    core_range_set: string;
}

interface TensorParams {
    address: number;
    buffer_type: BufferType;
    device_id: number;
    device_tensors: string;
    dtype: string;
    layout: string;
    memory_config: string;
    shape: string;
    tensor_id: number;
    size: string;
}

interface NodeParamsByType {
    [NodeType.capture_start]: GraphMarkerParams;
    [NodeType.capture_end]: GraphMarkerParams;
    [NodeType.function_start]: GraphMarkerParams;
    [NodeType.function_end]: GraphMarkerParams;
    [NodeType.buffer]: BufferParams;
    [NodeType.buffer_allocate]: BufferParams;
    [NodeType.buffer_deallocate]: BufferParams;
    [NodeType.circular_buffer_allocate]: CircularBufferParams;
    [NodeType.circular_buffer_deallocate_all]: CircularBufferParams;
    [NodeType.tensor]: TensorParams;
}

interface BaseNode<T extends NodeType = NodeType> {
    connections: number[];
    id: number;
    node_type: T;
    params: NodeParamsByType[T];
    inputs: Node[];
    outputs: Node[];
    operation?: Node;
    buffer?: Node[];
    allocation?: Node;
    stacking_level: number;
}

type Node =
    | BaseNode<NodeType.capture_start>
    | BaseNode<NodeType.capture_end>
    | BaseNode<NodeType.function_start>
    | BaseNode<NodeType.function_end>
    | BaseNode<NodeType.buffer>
    | BaseNode<NodeType.buffer_allocate>
    | BaseNode<NodeType.buffer_deallocate>
    | BaseNode<NodeType.circular_buffer_allocate>
    | BaseNode<NodeType.circular_buffer_deallocate_all>
    | BaseNode<NodeType.tensor>;
