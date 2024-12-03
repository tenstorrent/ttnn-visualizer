# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import dataclasses
import enum
import json
from json import JSONDecodeError
from typing import Optional, Any

from pydantic import BaseModel, Field
from sqlalchemy import Integer, Column, String, JSON

from ttnn_visualizer.utils import SerializeableDataclass
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.extensions import db

from ttnn_visualizer.utils import parse_memory_config


class BufferType(enum.Enum):
    DRAM = 0
    L1 = 1
    SYSTEM_MEMORY = 2
    L1_SMALL = 3
    TRACE = 4


@dataclasses.dataclass
class Operation(SerializeableDataclass):
    operation_id: int
    name: str
    duration: float


@dataclasses.dataclass
class Device(SerializeableDataclass):
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
class DeviceOperation(SerializeableDataclass):
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
            self.captured_graph = json.dumps({})


@dataclasses.dataclass
class Buffer(SerializeableDataclass):
    operation_id: int
    device_id: int
    address: int
    max_size_per_bank: int
    buffer_type: BufferType


@dataclasses.dataclass
class BufferPage(SerializeableDataclass):
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


@dataclasses.dataclass
class ProducersConsumers(SerializeableDataclass):
    tensor_id: int
    producers: list[int]
    consumers: list[int]


@dataclasses.dataclass
class Tensor(SerializeableDataclass):
    tensor_id: int
    shape: str
    dtype: str
    layout: str
    memory_config: str | dict[str, Any] | None
    device_id: int
    address: int
    buffer_type: BufferType

    def __post_init__(self):
        self.memory_config = parse_memory_config(self.memory_config)


@dataclasses.dataclass
class InputTensor(SerializeableDataclass):
    operation_id: int
    input_index: int
    tensor_id: int


@dataclasses.dataclass
class OutputTensor(SerializeableDataclass):
    operation_id: int
    output_index: int
    tensor_id: int


@dataclasses.dataclass
class TensorComparisonRecord(SerializeableDataclass):
    tensor_id: int
    golden_tensor_id: int
    matches: bool
    desired_pcc: bool
    actual_pcc: float


@dataclasses.dataclass
class OperationArgument(SerializeableDataclass):
    operation_id: int
    name: str
    value: str


@dataclasses.dataclass
class StackTrace(SerializeableDataclass):
    operation_id: int
    stack_trace: str


# Non Data Models


class SerializeableModel(BaseModel):
    class Config:
        use_enum_values = True


class RemoteConnection(SerializeableModel):
    name: str
    username: str
    host: str
    port: int = Field(ge=1, le=65535)
    path: str
    sqliteBinaryPath: Optional[str] = None
    useRemoteQuerying: bool = False


class StatusMessage(SerializeableModel):
    status: ConnectionTestStates
    message: str


class ActiveReport(SerializeableModel):
    name: str


class RemoteReportFolder(SerializeableModel):
    testName: str
    remotePath: str
    lastModified: int
    lastSynced: Optional[int] = None


class TabSession(BaseModel):
    tab_id: str
    report_path: Optional[str] = None
    active_report: Optional[ActiveReport] = None
    remote_connection: Optional[RemoteConnection] = None
    remote_folder: Optional[RemoteReportFolder] = None


class TabSessionTable(db.Model):
    __tablename__ = "tab_sessions"

    id = Column(Integer, primary_key=True)
    tab_id = Column(String, unique=True, nullable=False)
    report_path = Column(String)
    active_report = Column(JSON)
    remote_connection = Column(JSON, nullable=True)
    remote_folder = Column(JSON, nullable=True)

    def __init__(
        self,
        tab_id,
        active_report,
        remote_connection=None,
        remote_folder=None,
        report_path=None,
    ):
        self.tab_id = tab_id
        self.active_report = active_report
        self.report_path = report_path
        self.remote_connection = remote_connection
        self.remote_folder = remote_folder

    def to_dict(self):
        return {
            "id": self.id,
            "tab_id": self.tab_id,
            "active_report": self.active_report,
            "remote_connection": self.remote_connection,
            "report_path": self.report_path,
        }

    def to_pydantic(self) -> TabSession:
        return TabSession(
            tab_id=str(self.tab_id),
            report_path=str(self.report_path) if self.report_path is not None else None,
            active_report=(
                (ActiveReport(**self.active_report) if self.active_report else None)
                if isinstance(self.active_report, dict)
                else None
            ),
            remote_connection=(
                RemoteConnection.model_validate(self.remote_connection, strict=False)
                if self.remote_connection is not None
                else None
            ),
            remote_folder=(
                RemoteReportFolder.model_validate(self.remote_folder, strict=False)
                if self.remote_folder is not None
                else None
            ),
        )
