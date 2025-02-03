# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import json
from typing import Generator, Dict, Any, Union

from ttnn_visualizer.exceptions import (
    DatabaseFileNotFoundException,
)
from ttnn_visualizer.models import (
    Operation,
    DeviceOperation,
    Buffer,
    BufferPage,
    TabSession,
    Tensor,
    OperationArgument,
    StackTrace,
    InputTensor,
    OutputTensor,
    Device,
    ProducersConsumers,
    TensorComparisonRecord,
)
from ttnn_visualizer.ssh_client import get_client
import sqlite3
from typing import List, Optional
from pathlib import Path
import paramiko


class LocalQueryRunner:
    def __init__(self, session: Optional[TabSession] = None, connection=None):

        if connection:
            self.connection = connection
        else:
            if not session or not session.report_path:
                raise ValueError("Report path must be provided for local queries")
            db_path = str(session.report_path)
            if not Path(db_path).exists():
                raise DatabaseFileNotFoundException(
                    f"Database not found at path: {db_path}"
                )
            self.connection = sqlite3.connect(
                session.report_path, isolation_level=None, timeout=30
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


class RemoteQueryRunner:
    column_delimiter = "|||"

    def __init__(self, session: TabSession):
        self.session = session
        self._validate_session()
        self.ssh_client = self._get_ssh_client(self.session.remote_connection)
        self.sqlite_binary = self.session.remote_connection.sqliteBinaryPath
        self.remote_db_path = str(
            Path(self.session.remote_folder.remotePath, "db.sqlite")
        )

    def _validate_session(self):
        """
        Validate that the session has all required remote connection attributes.
        """
        if (
            not self.session.remote_connection
            or not self.session.remote_connection.sqliteBinaryPath
            or not self.session.remote_folder
            or not self.session.remote_folder.remotePath
        ):
            raise ValueError(
                "Remote connections require remote path and sqliteBinaryPath"
            )

    def _get_ssh_client(self, remote_connection) -> paramiko.SSHClient:
        """
        Retrieve the SSH client for the given remote connection.
        """
        return get_client(remote_connection=remote_connection)

    def _format_query(self, query: str, params: Optional[List] = None) -> str:
        """
        Format the query by replacing placeholders with properly quoted parameters.
        """
        if not params:
            return query

        formatted_params = [
            f"'{param}'" if isinstance(param, str) else str(param) for param in params
        ]
        return query.replace("?", "{}").format(*formatted_params)

    def _build_command(self, formatted_query: str) -> str:
        """
        Build the remote SQLite command.
        """
        return f'{self.sqlite_binary} {self.remote_db_path} "{formatted_query}" -json'

    def _execute_ssh_command(self, command: str) -> tuple:
        """
        Execute the SSH command and return the standard output and error.
        """
        stdin, stdout, stderr = self.ssh_client.exec_command(command)
        output = stdout.read().decode("utf-8").strip()
        error_output = stderr.read().decode("utf-8").strip()
        return output, error_output

    def _parse_output(self, output: str, command: str) -> List:
        """
        Parse the output from the SQLite command. Attempt JSON parsing first,
        then fall back to line-based parsing.
        """
        if not output.strip():
            return []

        try:
            rows = json.loads(output)
            return [tuple(row.values()) for row in rows]
        except json.JSONDecodeError:
            print(
                f"Output is not valid JSON, attempting manual parsing.\nCommand: {command}"
            )
            return [tuple(line.split("|")) for line in output.splitlines()]

    def execute_query(self, query: str, params: Optional[List] = None) -> List:
        """
        Execute a remote SQLite query using the session's SSH client.
        """
        self._validate_session()
        formatted_query = self._format_query(query, params)
        command = self._build_command(formatted_query)
        output, error_output = self._execute_ssh_command(command)

        if error_output:
            raise RuntimeError(
                f"Error executing query remotely: {error_output}\nCommand: {command}"
            )

        return self._parse_output(output, command)

    def close(self):
        """
        Close the SSH connection.
        """
        if self.ssh_client:
            self.ssh_client.close()


class DatabaseQueries:

    session: Optional[TabSession] = None
    ssh_client = None
    query_runner: LocalQueryRunner | RemoteQueryRunner

    def __init__(self, session: Optional[TabSession] = None, connection=None):
        self.session = session

        if connection:
            self.query_runner = LocalQueryRunner(connection=connection)
        else:
            if not session:
                raise ValueError(
                    "Must provide either an existing connection or session"
                )
            remote_connection = session.remote_connection if session else None
            if remote_connection and remote_connection.useRemoteQuerying:
                self.query_runner = RemoteQueryRunner(session=session)
            else:
                self.query_runner = LocalQueryRunner(session=session)

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
        if isinstance(self.query_runner, RemoteQueryRunner):
            self.query_runner.close()
        elif isinstance(self.query_runner, LocalQueryRunner):
            self.query_runner.close()
