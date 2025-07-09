# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

from typing import Generator, Dict, Any, Union

from ttnn_visualizer.exceptions import (
    DatabaseFileNotFoundException,
)
from ttnn_visualizer.models import (
    Operation,
    DeviceOperation,
    Buffer,
    BufferPage,
    Instance,
    Tensor,
    OperationArgument,
    StackTrace,
    InputTensor,
    OutputTensor,
    Device,
    ProducersConsumers,
    TensorComparisonRecord,
)
import sqlite3
from typing import List, Optional
from pathlib import Path


class LocalQueryRunner:
    def __init__(self, instance: Optional[Instance] = None, connection=None):

        if connection:
            self.connection = connection
        else:
            if not instance or not instance.profiler_path:
                raise ValueError("Report path must be provided for local queries")
            db_path = str(instance.profiler_path)
            if not Path(db_path).exists():
                raise DatabaseFileNotFoundException(
                    f"Database not found at path: {db_path}"
                )
            self.connection = sqlite3.connect(
                instance.profiler_path, isolation_level=None, timeout=30
            )

    def execute_query(self, query: str, params: Optional[List] = None) -> List:
        """
        Executes a query locally using SQLite.
        """
        cursor = self.connection.cursor()
        try:
            cursor.execute(query, params or [])
            return cursor.fetchall()
        finally:
            cursor.close()

    def close(self):
        if self.connection:
            self.connection.close()


class DatabaseQueries:

    instance: Optional[Instance] = None
    query_runner: LocalQueryRunner

    def __init__(self, instance: Optional[Instance] = None, connection=None):
        self.instance = instance

        if connection:
            self.query_runner = LocalQueryRunner(connection=connection)
        else:
            if not instance:
                raise ValueError(
                    "Must provide either an existing connection or instance"
                )
            remote_connection = instance.remote_connection if instance else None
            if remote_connection and remote_connection.useRemoteQuerying:
                raise NotImplementedError("Remote querying is not implemented yet")
            else:
                self.query_runner = LocalQueryRunner(instance=instance)

    def _check_table_exists(self, table_name: str) -> bool:
        """
        Checks if a table exists in the database.
        This method works for both local and remote databases.
        """
        # Properly format the table name into the query string with single quotes
        query = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"

        # Use the execute_query method to handle both local and remote cases.
        rows = self.query_runner.execute_query(query, [table_name])

        return bool(rows)

    def _query_table(
        self,
        table_name: str,
        filters: Optional[Dict[str, Union[Any, List[Any]]]] = None,
        additional_conditions: Optional[str] = None,
        additional_params: Optional[List[Any]] = None,
    ) -> List[Any]:
        query = f"SELECT * FROM {table_name} WHERE 1=1"
        params = []

        if filters:
            for column, value in filters.items():
                if value is None:  # Skip filters with None values
                    continue

                if isinstance(value, list):  # Handle list-based filters
                    if len(value) == 0:  # Skip empty lists
                        continue
                    placeholders = ", ".join(["?"] * len(value))
                    query += f" AND {column} IN ({placeholders})"
                    params.extend(value)
                else:
                    query += f" AND {column} = ?"
                    params.append(value)

        if additional_conditions:
            query += f" {additional_conditions}"
            if additional_params:
                params.extend(additional_params)

        return self.query_runner.execute_query(query, params)

    def query_device_operations(
        self, filters: Optional[Dict[str, Union[Any, List[Any]]]] = None
    ) -> List[DeviceOperation]:
        if not self._check_table_exists("captured_graph"):
            return []
        rows = self._query_table("captured_graph", filters)
        return [DeviceOperation(*row) for row in rows]

    def query_operation_arguments(
        self, filters: Optional[Dict[str, Union[Any, List[Any]]]] = None
    ) -> Generator[OperationArgument, None, None]:
        rows = self._query_table("operation_arguments", filters)
        for row in rows:
            yield OperationArgument(*row)

    def query_operations(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Operation, None, None]:
        rows = self._query_table("operations", filters)
        for row in rows:
            yield Operation(*row)

    def query_buffers(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Buffer, None, None]:
        rows = self._query_table("buffers", filters)
        for row in rows:
            yield Buffer(*row)

    def query_stack_traces(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[StackTrace, None, None]:
        rows = self._query_table("stack_traces", filters)
        for row in rows:
            operation_id, stack_trace = row
            yield StackTrace(operation_id, stack_trace=stack_trace)

    def query_tensor_comparisons(
        self, local: bool = True, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[TensorComparisonRecord, None, None]:
        if local:
            table_name = "local_tensor_comparison_records"
        else:
            table_name = "global_tensor_comparison_records"
        rows = self._query_table(table_name, filters)
        for row in rows:
            yield TensorComparisonRecord(*row)

    def query_buffer_pages(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[BufferPage, None, None]:
        rows = self._query_table("buffer_pages", filters)
        for row in rows:
            yield BufferPage(*row)

    def query_tensors(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Tensor, None, None]:
        rows = self._query_table("tensors", filters)
        for row in rows:
            device_addresses = []

            try:
                device_tensors = self._query_table(
                    "device_tensors", filters={"tensor_id": row[0]}
                )
            except sqlite3.OperationalError as err:
                if str(err).startswith("no such table"):
                    pass
                else:
                    raise err
            else:
                for device_tensor in sorted(device_tensors, key=lambda x: x[1]):
                    while len(device_addresses) < device_tensor[1]:
                        device_addresses.append(None)
                    device_addresses.append(device_tensor[2])

            yield Tensor(*row, device_addresses)

    def query_input_tensors(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[InputTensor, None, None]:
        rows = self._query_table("input_tensors", filters)
        for row in rows:
            yield InputTensor(*row)

    def query_output_tensors(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[OutputTensor, None, None]:
        rows = self._query_table("output_tensors", filters)
        for row in rows:
            yield OutputTensor(*row)

    def query_devices(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Device, None, None]:
        rows = self._query_table("devices", filters)
        for row in rows:
            yield Device(*row)

    def query_producers_consumers(self) -> Generator[ProducersConsumers, None, None]:
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
        rows = self.query_runner.execute_query(query)
        for row in rows:
            tensor_id, producers_data, consumers_data = row
            producers = sorted(
                set(map(int, producers_data.strip('"').split(",")))
                if producers_data
                else []
            )
            consumers = sorted(
                set(map(int, consumers_data.strip('"').split(",")))
                if consumers_data
                else []
            )
            yield ProducersConsumers(tensor_id, producers, consumers)

    def query_next_buffer(self, operation_id: int, address: str) -> Optional[Buffer]:
        query = """
            SELECT
                buffers.operation_id,
                buffers.device_id,
                buffers.address,
                buffers.max_size_per_bank,
                buffers.buffer_type
            FROM
                buffers
            WHERE
                buffers.address = ?
                AND buffers.operation_id > ?
            ORDER BY buffers.operation_id
        """
        rows = self.query_runner.execute_query(query, [address, operation_id])
        return Buffer(*rows[0]) if rows else None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if isinstance(self.query_runner, LocalQueryRunner):
            self.query_runner.close()
