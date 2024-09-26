import dataclasses
import enum
import sqlite3
from collections import defaultdict
from functools import wraps
from pathlib import Path
from timeit import default_timer


@dataclasses.dataclass
class Operation:
    operation_id: int
    name: str
    duration: float


SQLITE_DB_PATH = "db.sqlite"


class BufferType(enum.Enum):
    DRAM = 0
    L1 = 1
    SYSTEM_MEMORY = 2
    L1_SMALL = 3
    TRACE = 4


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
        "SELECT * FROM operations WHERE operation_id < ? ORDER BY operation_id DESC LIMIT 1",
        (operation_id,),
    )
    previous_operation = None
    for row in cursor.fetchall():
        previous_operation = Operation(*row)
        break

    cursor.execute(
        "SELECT * FROM operations WHERE operation_id > ? ORDER BY operation_id ASC LIMIT 1",
        (operation_id,),
    )
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


def query_operation_arguments(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM operation_arguments")
    for row in cursor.fetchall():
        operation_argument = OperationArgument(*row)
        yield operation_argument

    sqlite_connection.close()


def query_operation_arguments_by_operation_id(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute(
        "SELECT * FROM operation_arguments WHERE operation_id = ?", (operation_id,)
    )
    for row in cursor.fetchall():
        operation_argument = OperationArgument(*row)
        yield operation_argument

    sqlite_connection.close()


def query_stack_traces(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM stack_traces")
    stack_trace = None
    for row in cursor.fetchall():
        stack_trace = StackTrace(*row)
        yield stack_trace

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


def query_input_tensors(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM input_tensors")
    for row in cursor.fetchall():
        yield InputTensor(*row)

    sqlite_connection.close()


def query_input_tensors_by_operation_id(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute(
        "SELECT * FROM input_tensors WHERE operation_id = ?", (operation_id,)
    )
    for row in cursor.fetchall():
        yield InputTensor(*row)

    sqlite_connection.close()


def query_output_tensors_by_operation_id(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute(
        "SELECT * FROM output_tensors WHERE operation_id = ?", (operation_id,)
    )
    for row in cursor.fetchall():
        yield OutputTensor(*row)

    sqlite_connection.close()


def query_output_tensors(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM output_tensors")
    for row in cursor.fetchall():
        yield OutputTensor(*row)

    sqlite_connection.close()


def query_tensors_by_tensor_ids(report_path, tensor_ids):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute(
        "SELECT * FROM tensors WHERE tensor_id IN (%s)"
        % ",".join("?" * len(tensor_ids)),
        tensor_ids,
    )
    for row in cursor.fetchall():
        yield Tensor(*row)

    sqlite_connection.close()


def query_tensors(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM tensors")
    for row in cursor.fetchall():
        yield Tensor(*row)

    sqlite_connection.close()


def query_output_tensors_by_id(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute(
        "SELECT * FROM output_tensors WHERE operation_id = ?", (operation_id,)
    )
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


def query_devices(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute("SELECT * FROM devices")
    operation_id = None
    for row in cursor.fetchall():
        device = Device(*row)
        yield device
    sqlite_connection.close()

    return operation_id


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


def query_producers_consumers(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    cursor.execute(
        """
            SELECT
              t.tensor_id,
              GROUP_CONCAT(it.operation_id, ', ') AS consumers,
              GROUP_CONCAT(ot.operation_id, ', ') AS producers
            FROM
              tensors t
            LEFT JOIN
              input_tensors it ON t.tensor_id = it.tensor_id
             LEFT JOIN
              output_tensors ot on t.tensor_id = ot.tensor_id
            GROUP BY
              t.tensor_id;
    """
    )
    for row in cursor.fetchall():
        tensor_id, producers, consumers = row
        if producers:
            producers = set(map(int, producers.split(",")))
        if consumers:
            consumers = set(map(int, consumers.split(",")))
        producer_consumers = ProducersConsumers(
            tensor_id, list(producers or []), list(consumers or [])
        )
        yield producer_consumers


def perform_query(query, sqlite_db_path):
    if not Path(sqlite_db_path).exists():
        raise FileNotFoundError(f"{sqlite_db_path} does not exist")
    sqlite3.connect(sqlite_db_path)


def timer(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        start_time = default_timer()
        response = f(*args, **kwargs)
        total_elapsed_time = default_timer() - start_time
        print(f"Elapsed time: {total_elapsed_time}")
        return response

    return wrapper


def operation(report_path, operation_id):

    operation = query_operation_by_id(report_path, operation_id)

    buffers = query_buffers(report_path, operation_id)
    operation_arguments = query_operation_arguments_by_operation_id(
        report_path, operation_id
    )
    stack_trace = query_stack_trace(report_path, operation_id)

    inputs = list(query_input_tensors_by_operation_id(report_path, operation_id))
    outputs = list(query_output_tensors_by_operation_id(report_path, operation_id))
    input_tensor_ids = [i.tensor_id for i in inputs]
    output_tensor_ids = [o.tensor_id for o in outputs]
    tensor_ids = input_tensor_ids + output_tensor_ids
    tensors = list(query_tensors_by_tensor_ids(report_path, tensor_ids))
    producers_consumers = list(
        filter(
            lambda pc: pc.tensor_id in tensor_ids,
            query_producers_consumers(report_path),
        )
    )

    devices = list(query_devices(report_path))

    return serialize_operation(
        buffers,
        inputs,
        operation,
        operation_arguments,
        outputs,
        stack_trace,
        tensors,
        devices,
        producers_consumers,
    )


def tensor_list(report_path):
    tensors = query_tensors(report_path)
    results = []
    for tensor in tensors:
        tensor_data = dataclasses.asdict(tensor)
        tensor_data.update({"consumers": [], "producers": []})  # TODO
        tensor_data.update({"id": tensor_data.pop("tensor_id")})
        results.append(tensor_data)
    return results


@timer
def operations_list(report_path):
    operations = list(query_operations(report_path))
    operation_arguments = list(query_operation_arguments(report_path))
    stack_traces = list(query_stack_traces(report_path))
    outputs = list(query_output_tensors(report_path))
    tensors = list(query_tensors(report_path))
    inputs = list(query_input_tensors(report_path))
    devices = list(query_devices(report_path))
    producers_consumers = query_producers_consumers(report_path)

    return serialize_operations(
        inputs,
        operation_arguments,
        operations,
        outputs,
        stack_traces,
        tensors,
        devices,
        producers_consumers,
    )


def serialize_operations(
    inputs,
    operation_arguments,
    operations,
    outputs,
    stack_traces,
    tensors,
    devices,
    producers_consumers,
):
    tensors_dict = dict()
    for t in tensors:
        tensors_dict.update({t.tensor_id: t})

    stack_traces_dict = defaultdict(str)
    for stack_trace in stack_traces:
        stack_traces_dict.update({stack_trace.operation_id: stack_trace.stack_trace})

    # Join Arguments
    arguments_dict = defaultdict(list)
    for argument in operation_arguments:
        arguments_dict[argument.operation_id].append(argument)

    inputs_dict, outputs_dict = serialize_inputs_outputs(
        inputs, outputs, producers_consumers, tensors_dict
    )

    # Serialize Final Results
    results = []
    for operation in operations:
        inputs = inputs_dict[operation.operation_id]
        outputs = outputs_dict[operation.operation_id]
        arguments = [
            dataclasses.asdict(a) for a in arguments_dict[operation.operation_id]
        ]
        operation_data = dataclasses.asdict(operation)
        operation_data.update({"id": operation.operation_id})
        results.append(
            dict(
                stack_trace=stack_traces_dict.get(operation.operation_id),
                **operation_data,
                arguments=arguments,
                inputs=inputs,
                outputs=outputs,
            )
        )
    return results


def serialize_inputs_outputs(inputs, outputs, producers_consumers, tensors_dict):

    producers_consumers_dict = dict()
    for pc in producers_consumers:
        producers_consumers_dict.update({pc.tensor_id: pc})
    # Serialize Inputs
    inputs_dict = defaultdict(list)
    for input in inputs:
        input_tensor = dataclasses.asdict(tensors_dict[input.tensor_id])
        producers_consumers = producers_consumers_dict.get(input.tensor_id)
        input_tensor.update(
            {
                "consumers": producers_consumers.consumers,
                "producers": producers_consumers.producers,
            }
        )

        input_data = dataclasses.asdict(input)
        input_data.pop("tensor_id")
        inputs_dict[input.operation_id].append(dict(**input_data, **input_tensor))
    # Serialize Outputs
    outputs_dict = defaultdict(list)
    for output in outputs:
        output_tensor = dataclasses.asdict(tensors_dict[output.tensor_id])
        producers_consumers = producers_consumers_dict.get(output.tensor_id)
        output_tensor.update(
            {
                "consumers": producers_consumers.consumers,
                "producers": producers_consumers.producers,
            }
        )

        output_data = dataclasses.asdict(output)
        output_data.pop("tensor_id")
        outputs_dict[output.operation_id].append(dict(**output_data, **output_tensor))
    return inputs_dict, outputs_dict


def serialize_operation(
    buffers,
    inputs,
    operation,
    operation_arguments,
    outputs,
    stack_trace,
    tensors,
    devices,
    producers_consumers,
):

    tensors_dict = dict()
    for t in tensors:
        tensors_dict.update({t.tensor_id: t})

    producers_consumers_dict = dict()
    for pc in producers_consumers:
        producers_consumers_dict.update({pc.tensor_id: pc})

    inputs_dict, outputs_dict = serialize_inputs_outputs(
        inputs, outputs, producers_consumers, tensors_dict
    )

    # Serialize Buffers
    buffer_list = []
    for buffer in buffers:
        buffer_data = dataclasses.asdict(buffer)
        buffer_list.append(buffer_data)

    l1_sizes = [d.worker_l1_size for d in devices]
    arguments_data = [dataclasses.asdict(argument) for argument in operation_arguments]
    operation_data = operation.__dict__.copy()
    operation_data.update({"id": operation.operation_id})

    inputs_data = list(inputs_dict.values())
    outputs_data = list(outputs_dict.values())
    return dict(
        **operation_data,
        l1_sizes=l1_sizes,
        stack_trace=stack_trace or "",
        buffers=buffer_list,
        arguments=arguments_data,
        inputs=inputs_data,
        outputs=outputs_data,
    )
