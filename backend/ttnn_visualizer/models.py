import dataclasses
import enum
import json
from json import JSONDecodeError

from pydantic import BaseModel, Field


class BufferType(enum.Enum):
    DRAM = 0
    L1 = 1
    SYSTEM_MEMORY = 2
    L1_SMALL = 3
    TRACE = 4


@dataclasses.dataclass
class Operation:
    operation_id: int
    name: str
    duration: float


@dataclasses.dataclass
class Device:
    device_id: int
    num_y_cores: int
    num_x_cores: int
    num_y_compute_cores: int
    num_x_compute_cores: int
    worker_l1_size: int
    l1_num_banks: int
    l1_bank_size: int
    address_at_first_l1_bank: int
    address_at_first_l1_cb_buffer: int
    num_banks_per_storage_core: int
    num_compute_cores: int
    num_storage_cores: int
    total_l1_memory: int
    total_l1_for_tensors: int
    total_l1_for_interleaved_buffers: int
    total_l1_for_sharded_buffers: int
    cb_limit: int


@dataclasses.dataclass
class DeviceOperation:
    operation_id: int
    captured_graph: str

    def __post_init__(self):
        try:
            captured_graph = json.loads(self.captured_graph)
            for graph in captured_graph:
                id = graph.pop("counter")
                graph.update({"id": id})

            self.captured_graph = captured_graph

        except JSONDecodeError:
            self.captured_graph = []


@dataclasses.dataclass
class Buffer:
    operation_id: int
    device_id: int
    address: int
    max_size_per_bank: int
    buffer_type: BufferType

    def __post_init__(self):
        self.buffer_type = (
            BufferType(self.buffer_type).value if self.buffer_type is not None else None
        )


@dataclasses.dataclass
class BufferPage:
    operation_id: int
    device_id: int
    address: int
    core_y: int
    core_x: int
    bank_id: int
    page_index: int
    page_address: int
    page_size: int
    buffer_type: BufferType

    def __post_init__(self):
        self.buffer_type = (
            BufferType(self.buffer_type).value if self.buffer_type is not None else None
        )


@dataclasses.dataclass
class ProducersConsumers:
    tensor_id: int
    producers: list[int]
    consumers: list[int]


@dataclasses.dataclass
class Tensor:
    tensor_id: int
    shape: str
    dtype: str
    layout: str
    memory_config: str
    device_id: int
    address: int
    buffer_type: BufferType

    def __post_init__(self):
        self.buffer_type = (
            BufferType(self.buffer_type).value if self.buffer_type is not None else None
        )


@dataclasses.dataclass
class InputTensor:
    operation_id: int
    input_index: int
    tensor_id: int


@dataclasses.dataclass
class OutputTensor:
    operation_id: int
    output_index: int
    tensor_id: int


@dataclasses.dataclass
class TensorComparisonRecord:
    tensor_id: int
    golden_tensor_id: int
    matches: bool
    desired_pcc: bool
    actual_pcc: float


@dataclasses.dataclass
class OperationArgument:
    operation_id: int
    name: str
    value: str


@dataclasses.dataclass
class StackTrace:
    operation_id: int
    stack_trace: str


# Non Data Models


class RemoteConnection(BaseModel):
    name: str
    username: str
    host: str
    port: int = Field(ge=1, le=65535)
    path: str


class StatusMessage(BaseModel):
    status: int
    message: str


class RemoteFolder(BaseModel):
    testName: str
    remotePath: str
    lastModified: int
