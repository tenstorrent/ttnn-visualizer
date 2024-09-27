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
        if not result:
            return None
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
        producers = []
        consumers = []
        tensor_id, producers_data, consumers_data = row
        if producers_data:
            unique_producers = set(map(int, producers_data.split(",")))
            producers = list(unique_producers)
            producers.sort()
        if consumers_data:
            unique_consumers = set(map(int, consumers_data.split(",")))
            consumers = list(unique_consumers)
            consumers.sort()
        producer_consumers = ProducersConsumers(tensor_id, producers, consumers)
        yield producer_consumers
