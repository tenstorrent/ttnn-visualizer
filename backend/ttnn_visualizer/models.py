# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
import enum
import re
from pathlib import Path
from typing import Any, Optional, Tuple

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import JSON, Column, Integer, String
from sqlalchemy.ext.mutable import MutableDict
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.extensions import db
from ttnn_visualizer.utils import SerializeableDataclass, parse_memory_config


class BufferType(enum.Enum):
    DRAM = 0
    L1 = 1
    SYSTEM_MEMORY = 2
    L1_SMALL = 3
    TRACE = 4


class ReportLocation(enum.Enum):
    LOCAL = "local"
    REMOTE = "remote"


@dataclasses.dataclass
class Operation(SerializeableDataclass):
    operation_id: int
    name: str
    duration: float
    rank: int = 0


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
    total_l1_memory: int
    total_l1_for_tensors: int
    total_l1_for_interleaved_buffers: int
    total_l1_for_sharded_buffers: int
    cb_limit: int
    rank: int = 0


@dataclasses.dataclass
class DeviceOperation(SerializeableDataclass):
    operation_id: int
    captured_graph: str
    rank: int = 0

    def __post_init__(self):
        # captured_graph is already valid JSON from the report DB; we keep it
        # as a raw string and splice it directly into API responses via
        # orjson.Fragment, avoiding an unnecessary parse/re-dump round trip.
        if not self.captured_graph:
            self.captured_graph = "[]"


@dataclasses.dataclass
class Buffer(SerializeableDataclass):
    operation_id: int
    device_id: int
    address: int
    max_size_per_bank: int
    buffer_type: BufferType
    buffer_layout: Optional[int] = None
    rank: int = 0


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
    rank: int = 0


@dataclasses.dataclass
class BufferChunk(SerializeableDataclass):
    """
    Per-(operation, device, address, bank, core) collapsed view of buffer pages.

    Sourced either from a pre-aggregated ``buffer_chunks`` table or by
    aggregating the legacy ``buffer_pages`` table on the fly.
    """

    operation_id: int
    device_id: int
    address: int
    bank_id: int
    core_x: int
    core_y: int
    chunk_address: int
    chunk_size: int
    page_size: int
    num_pages: int
    buffer_type: BufferType
    rank: int = 0


@dataclasses.dataclass
class ProducersConsumers(SerializeableDataclass):
    tensor_id: int
    producers: list[int]
    consumers: list[int]
    rank: int = 0


@dataclasses.dataclass
class TensorLifetime(SerializeableDataclass):
    producer_operation_id: Optional[int] = None
    last_use_operation_id: Optional[int] = None
    deallocate_operation_id: Optional[int] = None
    producer_source_file: Optional[str] = None
    producer_source_line: Optional[int] = None
    last_use_source_file: Optional[str] = None
    last_use_source_line: Optional[int] = None


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
    device_addresses: list[int]
    size: Optional[int] = None
    lifetime: Optional[TensorLifetime] = None
    rank: int = 0

    def __post_init__(self):
        self.memory_config = parse_memory_config(self.memory_config)


@dataclasses.dataclass
class InputTensor(SerializeableDataclass):
    operation_id: int
    input_index: int
    tensor_id: int
    rank: int = 0


@dataclasses.dataclass
class OutputTensor(SerializeableDataclass):
    operation_id: int
    output_index: int
    tensor_id: int
    rank: int = 0


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
    rank: int = 0


@dataclasses.dataclass
class SourceFile(SerializeableDataclass):
    id: int
    # SQLite columns are nullable: empty/NULL contents fall through to
    # tt-metal local/SSH; a NULL path skips the exact-path lookup.
    path: Optional[str] = None
    contents: Optional[str] = None


@dataclasses.dataclass
class StackTrace(SerializeableDataclass):
    operation_id: int
    stack_trace: str
    source_file_id: Optional[int] = None
    rank: int = 0


@dataclasses.dataclass
class ErrorRecord(SerializeableDataclass):
    operation_id: int
    operation_name: str
    error_type: str
    error_message: str
    stack_trace: str
    timestamp: str
    rank: int = 0

    def to_nested_dict(self) -> dict:
        """
        Returns a dictionary representation without operation_id and operation_name.
        Use this when the error is nested under an operation to avoid redundancy.
        """
        result = self.to_dict()
        result.pop("operation_id", None)
        result.pop("operation_name", None)
        return result


# Non Data Models


class SerializeableModel(BaseModel):
    class Config:
        use_enum_values = True


def sanitise_path_segment(value: object) -> str:
    """Collapse a user-provided path-ish string to a single safe path segment."""
    if not isinstance(value, str):
        return value  # type: ignore[return-value]
    safe_segment = Path(value.replace("\\", "/")).name.strip()
    if not safe_segment or safe_segment in {".", ".."}:
        raise ValueError("must not be empty")
    return safe_segment


# Rank is read as a number at the discovery boundary and every name is derived
# back from that number, so one rank has one spelling everywhere. Both patterns
# stay case-insensitive for *reading*: the remote tree is not ours to spell, and
# folders synced before normalisation can carry the remote's capitalisation.
# `re.ASCII` because the digits have to be readable as a number, and because the
# client renders the same names from JavaScript's ASCII-only `\d`.
RANK_DIRECTORY_RE = re.compile(r"^rank(\d+)$", re.IGNORECASE | re.ASCII)
RANK_SUFFIX_RE = re.compile(r"_rank(\d+)$", re.IGNORECASE | re.ASCII)


def split_rank_suffix(segment: str) -> Tuple[str, Optional[int]]:
    """Split a synced folder name into the report's own name and its rank.

    Only sound for names this codebase qualified, so callers gate it on the same
    multihost setting the write path uses — a single-host report genuinely named
    ``<name>_rank3`` is not rank 3 of ``<name>``.
    """
    match = RANK_SUFFIX_RE.search(segment)
    if not match:
        return segment, None

    return segment[: match.start()], int(match.group(1))


def rank_from_remote_path(remote_path: Optional[str]) -> Optional[int]:
    """Rank of a multihost report from the folder it sits under. None if single-host.

    Authoritative definition of a rank directory, and the only place a rank is
    parsed out of a remote path. Only ancestors are considered: a report
    directory that is itself named ``rank5`` is a report, and treating it as its
    own rank would leave it unqualified and free to collide with the other ranks
    of the same launch.
    """
    if not remote_path:
        return None
    for part in reversed(Path(remote_path).parent.parts):
        match = RANK_DIRECTORY_RE.match(part)
        if match:
            return int(match.group(1))
    return None


def folder_segment_from_remote_path(
    remote_path: Optional[str], *, qualify_rank: bool = False
) -> Optional[str]:
    """Sanitised local folder segment for a remote report, or None if invalid.

    Sync destinations, mount lookups and last-synced probes must all use this so
    write and read segments stay aligned (``sftp_operations`` ↔ ``views``).

    With ``qualify_rank``, the segment carries the report's rank: every rank of
    one ``tt-run --tracy`` launch names its report from its own start time at
    second granularity, so ranks routinely produce the same basename and would
    otherwise sync on top of each other. It stays a single flat segment because
    callers join it straight onto the report directory.

    Callers opt in from the connection's multihost setting rather than from the
    shape of the path, so a single-host connection aimed at one rank's reports
    keeps the names it has already synced under.
    """
    if remote_path is None:
        return None
    try:
        segment = sanitise_path_segment(Path(remote_path).name)
    except (TypeError, ValueError):
        return None

    if not qualify_rank:
        return segment

    rank = rank_from_remote_path(remote_path)
    if rank is None:
        return segment
    # Built from the parsed number rather than echoing the remote directory, so
    # `rank0/`, `Rank0/` and `rank00/` name one local folder instead of three.
    # The suffix is applied to the sanitised segment, so the qualifier survives
    # whatever `sanitise_path_segment` did to the basename.
    return f"{segment}_rank{rank}"


def sanitise_remote_host_segment(value: object) -> str:
    """Normalise a user-provided host to a single safe path segment."""
    return sanitise_path_segment(value)


class RemoteConnection(SerializeableModel):
    name: str
    username: str
    host: str
    port: int = Field(ge=1, le=65535)
    profilerPath: str
    performancePath: Optional[str] = None
    identityFile: Optional[str] = None
    # `tt-run --tracy` writes one report per rank under <performancePath>/<rank>/,
    # so multihost discovery has to search one directory level deeper.
    multihostPerformance: bool = False

    @field_validator("host", mode="before")
    @classmethod
    def _sanitise_host(cls, value: object) -> str:
        return sanitise_remote_host_segment(value)


class MlirServerConnection(SerializeableModel):
    """SSH target plus Model Explorer HTTP port on the remote host's loopback.

    Wire format matches ``MlirServerConnection`` in ``src/definitions/MlirServer.ts``.
    ``port`` is the MLIR HTTP port; ``sshPort`` is SSH (maps to ``RemoteConnection.port``).
    """

    name: str = ""
    username: str
    host: str
    sshPort: int = Field(default=22, ge=1, le=65535)
    port: int = Field(ge=1, le=65535)
    identityFile: Optional[str] = None

    @field_validator("username", mode="before")
    @classmethod
    def _strip_required_strings(cls, value: object) -> str:
        if not isinstance(value, str):
            return value  # type: ignore[return-value]
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be empty")
        return stripped

    @field_validator("host", mode="before")
    @classmethod
    def _sanitise_host(cls, value: object) -> str:
        return sanitise_remote_host_segment(value)

    @field_validator("name", mode="before")
    @classmethod
    def _strip_name(cls, value: object) -> str:
        if isinstance(value, str):
            return value.strip()
        return ""

    def to_remote_connection(self) -> RemoteConnection:
        return RemoteConnection(
            name=self.name or self.host,
            username=self.username,
            host=self.host,
            port=self.sshPort,
            profilerPath="",
            identityFile=self.identityFile,
        )


class StatusMessage(SerializeableModel):
    status: ConnectionTestStates
    message: str
    detail: Optional[str] = None


class ActiveReports(SerializeableModel):
    profiler_name: Optional[str] = None
    profiler_location: Optional[ReportLocation] = None
    performance_name: Optional[str] = None
    performance_location: Optional[ReportLocation] = None
    npe_name: Optional[str] = None
    npe_location: Optional[ReportLocation] = None
    mlir_name: Optional[str] = None
    mlir_location: Optional[ReportLocation] = None


class RemoteReportFolder(SerializeableModel):
    reportName: str
    remotePath: str
    lastModified: int
    lastSynced: Optional[int] = None
    # The name this report occupies (or would occupy) on local disk once synced,
    # and its rank. The server owns both because it is the side that writes the
    # folder; the client reads them back rather than re-deriving the rule.
    syncedName: Optional[str] = None
    rank: Optional[int] = None


class Instance(BaseModel):
    instance_id: str
    profiler_path: Optional[str] = None
    performance_path: Optional[str] = None
    npe_path: Optional[str] = None
    mlir_path: Optional[str] = None
    active_report: Optional[ActiveReports] = None
    remote_connection: Optional[RemoteConnection] = None
    remote_profiler_folder: Optional[RemoteReportFolder] = None
    remote_performance_folder: Optional[RemoteReportFolder] = None


class InstanceTable(db.Model):
    __tablename__ = "instances"

    id = Column(Integer, primary_key=True)
    instance_id = Column(String, unique=True, nullable=False)
    profiler_path = Column(String)
    performance_path = Column(String, nullable=True)
    npe_path = Column(String, nullable=True)
    mlir_path = Column(String, nullable=True)
    active_report = db.Column(MutableDict.as_mutable(JSON), nullable=False, default={})
    remote_connection = Column(JSON, nullable=True)
    remote_profiler_folder = Column(JSON, nullable=True)
    remote_performance_folder = Column(JSON, nullable=True)

    def __init__(
        self,
        instance_id,
        active_report,
        remote_connection=None,
        remote_profiler_folder=None,
        remote_performance_folder=None,
        profiler_path=None,
        performance_path=None,
        npe_path=None,
        mlir_path=None,
    ):
        self.instance_id = instance_id
        self.active_report = active_report
        self.profiler_path = profiler_path
        self.npe_path = npe_path
        self.mlir_path = mlir_path
        self.remote_connection = remote_connection
        self.remote_profiler_folder = remote_profiler_folder
        self.performance_path = performance_path
        self.remote_performance_folder = remote_performance_folder

    def to_dict(self):
        return {
            "id": self.id,
            "instance_id": self.instance_id,
            "active_report": self.active_report,
            "remote_connection": self.remote_connection,
            "remote_profiler_folder": self.remote_profiler_folder,
            "remote_performance_folder": self.remote_performance_folder,
            "profiler_path": self.profiler_path,
            "performance_path": self.performance_path,
            "npe_path": self.npe_path,
            "mlir_path": self.mlir_path,
        }

    def to_pydantic(self) -> Instance:
        return Instance(
            instance_id=str(self.instance_id),
            profiler_path=(
                str(self.profiler_path) if self.profiler_path is not None else None
            ),
            performance_path=(
                str(self.performance_path)
                if self.performance_path is not None
                else None
            ),
            npe_path=(str(self.npe_path) if self.npe_path is not None else None),
            mlir_path=(str(self.mlir_path) if self.mlir_path is not None else None),
            active_report=(
                (ActiveReports(**self.active_report) if self.active_report else None)
                if isinstance(self.active_report, dict)
                else None
            ),
            remote_connection=(
                RemoteConnection.model_validate(self.remote_connection, strict=False)
                if self.remote_connection is not None
                else None
            ),
            remote_profiler_folder=(
                RemoteReportFolder.model_validate(
                    self.remote_profiler_folder, strict=False
                )
                if self.remote_profiler_folder is not None
                else None
            ),
            remote_performance_folder=(
                RemoteReportFolder.model_validate(
                    self.remote_performance_folder, strict=False
                )
                if self.remote_performance_folder is not None
                else None
            ),
        )
