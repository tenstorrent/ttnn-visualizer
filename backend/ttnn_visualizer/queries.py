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
    OperationArgument,
    StackTrace,
)
from ttnn_visualizer.serializers import (
    serialize_operations,
    serialize_operation,
    serialize_tensors,
)


SQLITE_DB_PATH = "db.sqlite"


def query_operation_by_id(cursor, operation_id):
    query = "SELECT * FROM operations WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    row = cursor.fetchone()
    if row:
        return Operation(*row)


def query_operations(cursor):
    query = "SELECT * FROM operations"
    cursor.execute(query)
    for row in cursor.fetchall():
        operation = Operation(*row)
        yield operation


def query_operation_arguments(cursor):
    query = "SELECT * FROM operation_arguments"
    cursor.execute(query)
    for row in cursor.fetchall():
        operation_argument = OperationArgument(*row)
        yield operation_argument


def query_operation_arguments_by_operation_id(cursor, operation_id):
    query = "SELECT * FROM operation_arguments WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    for row in cursor.fetchall():
        operation_argument = OperationArgument(*row)
        yield operation_argument


def query_stack_traces(cursor):
    query = "SELECT * FROM stack_traces"
    cursor.execute(query)
    for row in cursor.fetchall():
        stack_trace = StackTrace(*row)
        yield stack_trace


def query_stack_trace(cursor, operation_id):
    query = "SELECT * FROM stack_traces WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    stack_trace = None
    for row in cursor.fetchall():
        _, stack_trace = row
        break
    return stack_trace


def query_buffers(cursor, operation_id):
    query = "SELECT * FROM buffers WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    for row in cursor.fetchall():
        yield Buffer(*row)


def query_buffer_pages(cursor, operation_id):
    query = "SELECT * FROM buffer_pages WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    for row in cursor.fetchall():
        yield BufferPage(*row)


def query_tensor_by_id(cursor, tensor_id):
    query = "SELECT * FROM tensors WHERE tensor_id = ?"
    cursor.execute(query, (tensor_id,))
    tensor = None
    for row in cursor.fetchall():
        tensor = Tensor(*row)
        break
    return tensor


def query_input_tensors(cursor):
    query = "SELECT * FROM input_tensors"
    cursor.execute(query)
    for row in cursor.fetchall():
        yield InputTensor(*row)


def query_input_tensors_by_operation_id(cursor, operation_id):
    query = "SELECT * FROM input_tensors WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    for row in cursor.fetchall():
        yield InputTensor(*row)


def query_output_tensors_by_operation_id(cursor, operation_id):
    query = "SELECT * FROM output_tensors WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    for row in cursor.fetchall():
        yield OutputTensor(*row)


def query_output_tensors(cursor):
    query = "SELECT * from output_tensors"
    cursor.execute(query)
    for row in cursor.fetchall():
        yield OutputTensor(*row)


def query_tensors_by_tensor_ids(cursor, tensor_ids):
    query = "SELECT * FROM tensors WHERE tensor_id IN ({})".format(
        ",".join("?" * len(tensor_ids))
    )
    cursor.execute(query, tensor_ids)
    for row in cursor.fetchall():
        yield Tensor(*row)


def query_tensors(cursor):
    query = "SELECT * FROM tensors"
    cursor.execute(query)
    for row in cursor.fetchall():
        yield Tensor(*row)


def query_output_tensors_by_id(cursor, operation_id):
    query = "SELECT * FROM output_tensors WHERE operation_id = ?"
    cursor.execute(query, (operation_id,))
    for row in cursor.fetchall():
        yield OutputTensor(*row)


def query_output_tensor_by_tensor_id(cursor, tensor_id):
    query = "SELECT * FROM output_tensors WHERE tensor_id = ?"
    cursor.execute(query, (tensor_id,))
    output_tensor = None
    for row in cursor.fetchall():
        output_tensor = OutputTensor(*row)
        break
    return output_tensor


def query_devices(cursor):
    query = "SELECT * from devices"
    cursor.execute(query)
    for row in cursor.fetchall():
        device = Device(*row)
        yield device


# Function to check if a table exists
def check_table_exists(cursor, table_name):
    query = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
    cursor.execute(
        query,
        (table_name,),
    )
    result = cursor.fetchone()
    return bool(result)


def query_device_operations(cursor):
    if check_table_exists(cursor, "captured_graph"):
        cursor.execute("SELECT * FROM captured_graph")
        for row in cursor.fetchall():
            yield DeviceOperation(*row)
    else:
        yield []


def query_next_buffer(cursor, operation_id, address):
    query = """
        SELECT
            buffers.operation_id AS buffers_operation_id,
            buffers.device_id AS buffers_device_id,
            buffers.address AS buffers_address,
            buffers.max_size_per_bank AS buffers_max_size_per_bank,
            buffers.buffer_type AS buffers_buffer_type
        FROM
            buffers
        WHERE
            buffers.address = ?
            AND buffers.operation_id > ?
            ORDER BY buffers.operation_id
    """
    cursor.execute(query, (address, operation_id))
    row = cursor.fetchone()
    return Buffer(*row)


def query_device_operations_by_operation_id(cursor, operation_id):
    device_operation = None
    query = "SELECT * FROM captured_graph WHERE operation_id = ?"
    if check_table_exists(cursor, "captured_graph"):
        cursor.execute(query, (operation_id,))
        result = cursor.fetchone()
        operation_id, captured_graph = result
        device_operation = DeviceOperation(
            operation_id=operation_id, captured_graph=captured_graph
        )

    return device_operation


def query_consumer_operation_ids(cursor, tensor_id):
    query = "SELECT * FROM input_tensors WHERE tensor_id = ?"
    cursor.execute(query, (tensor_id,))
    for row in cursor.fetchall():
        operation_id, *_ = row
        yield operation_id


def query_producers_consumers(cursor):
    query = """
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
    cursor.execute(query)
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

    with sqlite3.connect(report_path / SQLITE_DB_PATH) as conn:
        cursor = conn.cursor()
        operation = query_operation_by_id(cursor, operation_id)

        buffers = query_buffers(cursor, operation_id)
        operation_arguments = query_operation_arguments_by_operation_id(
            cursor, operation_id
        )
        stack_trace = query_stack_trace(cursor, operation_id)

        inputs = list(query_input_tensors_by_operation_id(cursor, operation_id))
        outputs = list(query_output_tensors_by_operation_id(cursor, operation_id))
        input_tensor_ids = [i.tensor_id for i in inputs]
        output_tensor_ids = [o.tensor_id for o in outputs]
        tensor_ids = input_tensor_ids + output_tensor_ids
        tensors = list(query_tensors_by_tensor_ids(cursor, tensor_ids))
        device_operations = query_device_operations_by_operation_id(
            cursor, operation_id
        )

        producers_consumers = list(
            filter(
                lambda pc: pc.tensor_id in tensor_ids,
                query_producers_consumers(cursor),
            )
        )

        devices = list(query_devices(cursor))

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
    with sqlite3.connect(report_path / SQLITE_DB_PATH) as conn:
        cursor = conn.cursor()
        tensor = query_tensor_by_id(cursor, tensor_id)
        if tensor:
            return dataclasses.asdict(tensor)


@timer
def get_tensor_list(report_path):
    with sqlite3.connect(report_path / SQLITE_DB_PATH) as conn:
        cursor = conn.cursor()
        tensors = list(query_tensors(cursor))
        producers_consumers = list(query_producers_consumers(cursor))
        return serialize_tensors(tensors, producers_consumers)


@timer
def get_operations_list(report_path):

    with sqlite3.connect(report_path / SQLITE_DB_PATH) as conn:
        cursor = conn.cursor()
        operations = list(query_operations(cursor))
        operations.sort(key=lambda o: o.operation_id)
        operation_arguments = list(query_operation_arguments(cursor))
        device_operations = list(query_device_operations(cursor))
        stack_traces = list(query_stack_traces(cursor))
        outputs = list(query_output_tensors(cursor))
        tensors = list(query_tensors(cursor))
        inputs = list(query_input_tensors(cursor))
        devices = list(query_devices(cursor))
        producers_consumers = list(query_producers_consumers(cursor))

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
    with sqlite3.connect(report_path / SQLITE_DB_PATH) as conn:
        cursor = conn.cursor()
        buffer = query_next_buffer(cursor, operation_id, address)
        if buffer:
            return dataclasses.asdict(buffer)
