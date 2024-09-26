import dataclasses
import sqlite3
from functools import wraps
from pathlib import Path
from timeit import default_timer
from typing import Callable

from ttnn_visualizer.models import (
    Operation,
    Device,
    DeviceOperation,
    Buffer,
    BufferPage,
    ProducersConsumers,
    Tensor,
    InputTensor,
    OutputTensor,
    TensorComparisonRecord,
    OperationArgument,
    StackTrace,
)
from ttnn_visualizer.serializers import (
    serialize_operations,
    serialize_operation,
    serialize_tensors,
)


SQLITE_DB_PATH = "db.sqlite"


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


# Function to check if a table exists
def check_table_exists(conn, table_name):
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type='table' AND name=?;
    """,
        (table_name,),
    )

    # Fetch the result (if the table exists, this will return the name, otherwise None)
    result = cursor.fetchone()

    return bool(result)


def query_device_operations(report_path):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()

    if check_table_exists(sqlite_connection, "captured_graph"):
        cursor.execute("SELECT * FROM captured_graph")
        for row in cursor.fetchall():
            yield DeviceOperation(*row)
    else:
        yield []

    sqlite_connection.close()


def query_next_buffer(report_path, operation_id, address):

    query = """
    SELECT
    buffers.operation_id AS buffers_operation_id,
    buffers.device_id AS buffers_device_id,
    buffers.address AS buffers_address,
    buffers.max_size_per_bank AS buffers_max_size_per_bank,
    buffers.buffer_type AS buffers_buffer_type
FROM buffers
WHERE buffers.address = ? AND buffers.operation_id > ? ORDER BY buffers.operation_id ASC
    """
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()
    cursor.execute(query, (address, operation_id))
    row = cursor.fetchone()
    return Buffer(*row)


def query_device_operations_by_operation_id(report_path, operation_id):
    sqlite_connection = sqlite3.connect(report_path / SQLITE_DB_PATH)
    cursor = sqlite_connection.cursor()
    device_operation = None
    if check_table_exists(sqlite_connection, "captured_graph"):
        cursor.execute(
            "SELECT * FROM captured_graph where operation_id = ?", (operation_id,)
        )
        result = cursor.fetchone()
        operation_id, captured_graph = result
        device_operation = DeviceOperation(
            operation_id=operation_id, captured_graph=captured_graph
        )

    sqlite_connection.close()
    return device_operation


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
              GROUP_CONCAT(ot.operation_id, ', ') AS consumers,
              GROUP_CONCAT(it.operation_id, ', ') AS producers
            FROM
              tensors t
            LEFT JOIN
              input_tensors it ON t.tensor_id = it.tensor_id
             LEFT JOIN
              output_tensors ot on t.tensor_id = ot.tensor_id
            GROUP BY
              t.tensor_id

    """
    )
    for row in cursor.fetchall():
        tensor_id, producers, consumers = row
        if producers:
            producers = list(set(map(int, producers.split(","))))
            producers.sort()
        if consumers:
            consumers = list(set(map(int, consumers.split(","))))
            consumers.sort()
        producer_consumers = ProducersConsumers(
            tensor_id, producers or [], consumers or []
        )
        yield producer_consumers


def perform_query(query, sqlite_db_path):
    if not Path(sqlite_db_path).exists():
        raise FileNotFoundError(f"{sqlite_db_path} does not exist")
    sqlite3.connect(sqlite_db_path)


def timer(f: Callable):
    @wraps(f)
    def wrapper(*args, **kwargs):
        start_time = default_timer()
        response = f(*args, **kwargs)
        total_elapsed_time = default_timer() - start_time
        print(f"{f.__name__}: Elapsed time: {total_elapsed_time}")
        return response

    return wrapper


@timer
def get_operation(report_path, operation_id):

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
    device_operations = query_device_operations_by_operation_id(
        report_path, operation_id
    )

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
        device_operations,
    )


@timer
def get_tensor(report_path, tensor_id):
    tensor = query_tensor_by_id(report_path, tensor_id)
    if tensor:
        return dataclasses.asdict(tensor)
    return None


@timer
def get_tensor_list(report_path):
    tensors = list(query_tensors(report_path))
    producers_consumers = list(query_producers_consumers(report_path))
    return serialize_tensors(tensors, producers_consumers)


@timer
def get_operations_list(report_path):
    operations = list(query_operations(report_path))
    operations.sort(key=lambda o: o.operation_id)
    operation_arguments = list(query_operation_arguments(report_path))
    device_operations = list(query_device_operations(report_path))
    stack_traces = list(query_stack_traces(report_path))
    outputs = list(query_output_tensors(report_path))
    tensors = list(query_tensors(report_path))
    inputs = list(query_input_tensors(report_path))
    devices = list(query_devices(report_path))
    producers_consumers = list(query_producers_consumers(report_path))

    return serialize_operations(
        inputs,
        operation_arguments,
        operations,
        outputs,
        stack_traces,
        tensors,
        devices,
        producers_consumers,
        device_operations,
    )


@timer
def get_next_buffer(report_path, operation_id, address):
    buffer = query_next_buffer(report_path, operation_id, address)
    if buffer:
        return dataclasses.asdict(buffer)
    return None
