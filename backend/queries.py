import dataclasses
import enum
import sqlite3
from pathlib import Path

from backend.models import stack_traces


@dataclasses.dataclass
class Operation:
    operation_id: int
    name: str
    duration: float

SQLITE_DB_PATH = "db.sqlite"

class BufferType(enum.Enum):
    DRAM=0
    L1=1
    SYSTEM_MEMORY=2
    L1_SMALL=3
    TRACE=4

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
class Operation:
    operation_id: int
    name: str
    duration: float


@dataclasses.dataclass
class Buffer:
    operation_id: int
    device_id: int
    address: int
    max_size_per_bank: int
    buffer_type: BufferType

    def __post_init__(self):
        self.buffer_type = BufferType(self.buffer_type).name     if self.buffer_type is not None else None


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
        self.buffer_type = BufferType(self.buffer_type) if self.buffer_type is not None else None


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
        self.buffer_type = BufferType(self.buffer_type) if self.buffer_type is not None else None


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


def query_operation_by_id(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM operations WHERE operation_id = ?", (operation_id,))
    operation = None
    for row in cursor.fetchall():
        operation = Operation(*row)
        break

    sqlite_connection.close()

    return operation


def query_operation_by_id_together_with_previous_and_next(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM operations WHERE operation_id = ?", (operation_id,))
    operation = None
    for row in cursor.fetchall():
        operation = Operation(*row)
        break

    cursor.execute(
        "SELECT * FROM operations WHERE operation_id < ? ORDER BY operation_id DESC LIMIT 1", (operation_id,)
    )
    previous_operation = None
    for row in cursor.fetchall():
        previous_operation = Operation(*row)
        break

    cursor.execute("SELECT * FROM operations WHERE operation_id > ? ORDER BY operation_id ASC LIMIT 1", (operation_id,))
    next_operation = None
    for row in cursor.fetchall():
        next_operation = Operation(*row)
        break

    sqlite_connection.close()

    return operation, previous_operation, next_operation


def query_operations(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM operations")
    for row in cursor.fetchall():
        operation = Operation(*row)
        yield operation

    sqlite_connection.close()


def query_operation_arguments(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM operation_arguments WHERE operation_id = ?", (operation_id,))
    for row in cursor.fetchall():
        operation_argument = OperationArgument(*row)
        yield operation_argument

    sqlite_connection.close()


def query_stack_trace(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM stack_traces WHERE operation_id = ?", (operation_id,))
    stack_trace = None
    for row in cursor.fetchall():
        _, stack_trace = row
        break

    sqlite_connection.close()
    return stack_trace


def query_buffers(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM buffers WHERE operation_id = ?", (operation_id,))
    for row in cursor.fetchall():
        yield Buffer(*row)

    sqlite_connection.close()


def query_buffer_pages(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM buffer_pages WHERE operation_id = ?", (operation_id,))
    for row in cursor.fetchall():
        yield BufferPage(*row)

    sqlite_connection.close()


def query_tensor_by_id(report_path, tensor_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM tensors WHERE tensor_id = ?", (tensor_id,))
    tensor = None
    for row in cursor.fetchall():
        tensor = Tensor(*row)
        break

    sqlite_connection.close()

    return tensor


def query_input_tensors(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM input_tensors WHERE operation_id = ?", (operation_id,))
    for row in cursor.fetchall():
        yield InputTensor(*row)

    sqlite_connection.close()


def query_output_tensors(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM output_tensors WHERE operation_id = ?", (operation_id,))
    for row in cursor.fetchall():
        yield OutputTensor(*row)

    sqlite_connection.close()


def query_output_tensor_by_tensor_id(report_path, tensor_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM output_tensors WHERE tensor_id = ?", (tensor_id,))
    output_tensor = None
    for row in cursor.fetchall():
        output_tensor = OutputTensor(*row)
        break

    sqlite_connection.close()

    return output_tensor


def query_tensor_comparison_record(report_path, table_name, tensor_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute(f"SELECT * FROM {table_name} WHERE tensor_id = ?", (tensor_id,))
    tensor_comparison_record = None
    for row in cursor.fetchall():
        tensor_comparison_record = TensorComparisonRecord(*row)
        break

    sqlite_connection.close()

    return tensor_comparison_record


def query_producer_operation_id(report_path, tensor_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM output_tensors WHERE tensor_id = ?", (tensor_id,))
    operation_id = None
    for row in cursor.fetchall():
        operation_id, *_ = row
        break

    sqlite_connection.close()

    return operation_id


def query_consumer_operation_ids(report_path, tensor_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM input_tensors WHERE tensor_id = ?", (tensor_id,))
    for row in cursor.fetchall():
        operation_id, *_ = row
        yield operation_id

    sqlite_connection.close()


def get_operation_details(report_path, operation_id, exclusions=None):
    buffers = [] # use list(query_buffers(report_path, operation_id))
    input_tensors = list(query_input_tensors(report_path, operation_id))
    output_tensors = list(query_output_tensors(report_path, operation_id))
    stack_trace = query_stack_trace(report_path, operation_id)
    return dict(buffers=buffers, input_tensors=input_tensors,
                output_tensors=output_tensors, stack_trace=stack_trace)


def get_operations(report_path):
    operation_list = list(query_operations(report_path))
    return [
        dict(**o.__dict__, **get_operation_details(report_path, o.operation_id)) for o in operation_list
    ]




if __name__ == '__main__':
    file_dir = Path(__file__).resolve().parent.absolute()
    database_dir = file_dir / 'data' / 'active'
    operations = query_operations(database_dir)
    print(list(operations))
    print(database_dir)
