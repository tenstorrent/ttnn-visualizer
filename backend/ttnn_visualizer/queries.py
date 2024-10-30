import json
from typing import Generator


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

        if (
            not self.session.remote_connection
            or not self.session.remote_connection.sqliteBinaryPath
            or not self.session.remote_folder
            or not self.session.remote_folder.remotePath
        ):
            raise ValueError(
                "Remote connections require remote path and sqliteBinaryPath"
            )

        self.ssh_client = self._get_ssh_client(session.remote_connection)
        self.sqlite_binary = self.session.remote_connection.sqliteBinaryPath
        self.remote_db_path = str(
            Path(self.session.remote_folder.remotePath, "db.sqlite")
        )

    def _get_ssh_client(self, remote_connection) -> paramiko.SSHClient:
        return get_client(remote_connection=remote_connection)

    def execute_query(self, query: str, params: Optional[List] = None) -> List:
        if (
            not self.session.remote_connection
            or not self.session.remote_connection.sqliteBinaryPath
            or not self.session.remote_folder
            or not self.session.remote_folder.remotePath
        ):
            raise ValueError(
                "Remote connections require remote path and sqliteBinaryPath"
            )

        sqlite_binary = self.session.remote_connection.sqliteBinaryPath or "sqlite3"
        remote_db_path = str(Path(self.session.remote_folder.remotePath, "db.sqlite"))
        formatted_query = query

        if params:
            # Properly quote string parameters for SQLite, adding single quotes where needed
            formatted_params = [
                f"'{param}'" if isinstance(param, str) else str(param)
                for param in params
            ]
            formatted_query = formatted_query.replace("?", "{}").format(
                *formatted_params
            )

        command = f'{sqlite_binary} {remote_db_path} "{formatted_query}" -json'
        stdin, stdout, stderr = self.ssh_client.exec_command(command)
        output = (
            stdout.read().decode("utf-8").strip()
        )  # Read, decode, and strip extra whitespace
        error_output = stderr.read().decode("utf-8").strip()

        if error_output:
            raise RuntimeError(
                f"Error executing query remotely: {error_output}\nCommand: {command}"
            )

        # Handle empty output safely
        if not output.strip():
            return []

        # Try to parse JSON output or fallback to line-based parsing
        try:
            rows = json.loads(output)
            return [tuple(row.values()) for row in rows]
        except json.JSONDecodeError:
            # If output is not JSON, fallback to parsing using a pipe as a delimiter
            print("Output is not valid JSON, attempting manual parsing.")
            return [tuple(line.split("|")) for line in output.splitlines()]

    def close(self):
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

    # Query methods below:
    def query_device_operations(self) -> List[DeviceOperation]:
        # Check if the 'captured_graph' table exists before querying
        if not self._check_table_exists("captured_graph"):
            return []  # Return an empty list if the table does not exist

        query = "SELECT * FROM captured_graph"
        rows = self.query_runner.execute_query(query)
        return [DeviceOperation(*row) for row in rows]

    def query_device_operations_by_operation_id(
        self, operation_id: int
    ) -> Optional[DeviceOperation]:
        if not self._check_table_exists("captured_graph"):
            return None  # Return an empty list if the table does not exist
        query = "SELECT * FROM captured_graph WHERE operation_id = ?"
        rows = self.query_runner.execute_query(query, [operation_id])
        if rows:
            operation_id, captured_graph = rows[0]
            return DeviceOperation(
                operation_id=operation_id, captured_graph=captured_graph
            )
        return None

    def query_operations(self) -> Generator[Operation, None, None]:
        query = "SELECT * FROM operations"
        rows = self.query_runner.execute_query(query)
        for row in rows:
            yield Operation(*row)

    def query_operation_by_id(self, operation_id: int) -> Optional[Operation]:
        query = "SELECT * FROM operations WHERE operation_id = ?"
        rows = self.query_runner.execute_query(query, [operation_id])
        return Operation(*rows[0]) if rows else None

    def query_operation_arguments(self) -> Generator[OperationArgument, None, None]:
        query = "SELECT * FROM operation_arguments"
        rows = self.query_runner.execute_query(query)
        for row in rows:
            yield OperationArgument(*row)

    def query_operation_arguments_by_operation_id(
        self, operation_id: int
    ) -> Generator[OperationArgument, None, None]:
        query = "SELECT * FROM operation_arguments WHERE operation_id = ?"
        rows = self.query_runner.execute_query(query, [operation_id])
        for row in rows:
            yield OperationArgument(*row)

    def query_stack_traces(self) -> Generator[StackTrace, None, None]:
        query = "SELECT * FROM stack_traces"
        rows = self.query_runner.execute_query(query)
        for row in rows:
            operation_id, stack_trace = row
            yield StackTrace(operation_id, stack_trace=stack_trace)

    def query_stack_trace(self, operation_id: int) -> Optional[StackTrace]:
        query = "SELECT * FROM stack_traces WHERE operation_id = ?"
        rows = self.query_runner.execute_query(query, [operation_id])
        if rows:
            operation_id, stack_trace = rows[0]
            return StackTrace(operation_id, stack_trace=stack_trace)
        return None

    def query_buffers(
        self, buffer_type: Optional[int] = None
    ) -> Generator[Buffer, None, None]:
        query = "SELECT * FROM buffers WHERE 1=1"
        params = []
        if buffer_type is not None:
            query += " AND buffer_type = ?"
            params.append(buffer_type)
        rows = self.query_runner.execute_query(query, params)
        for row in rows:
            yield Buffer(*row)

    def query_buffers_by_operation_id(
        self, operation_id: int, buffer_type: Optional[int] = None
    ) -> Generator[Buffer, None, None]:
        query = "SELECT * FROM buffers WHERE operation_id = ?"
        params = [operation_id]
        if buffer_type is not None:
            query += " AND buffer_type = ?"
            params.append(buffer_type)
        rows = self.query_runner.execute_query(query, params)
        for row in rows:
            yield Buffer(*row)

    def query_buffer_pages(
        self,
        operation_id=None,
        addresses=None,
        buffer_type=None,
    ) -> Generator[BufferPage, None, None]:
        # noinspection SqlConstantExpression
        query = "SELECT * FROM buffer_pages WHERE 1=1"
        params = []

        # Add optional conditions
        if operation_id is not None:
            query += " AND operation_id = ?"
            params.append(operation_id)

        if addresses is not None and len(addresses) > 0:
            placeholders = ",".join(["?"] * len(addresses))
            query += f" AND address IN ({placeholders})"
            params.extend(addresses)

        if buffer_type is not None:
            query += " AND buffer_type = ?"
            params.append(buffer_type)

        rows = self.query_runner.execute_query(query, params)
        for row in rows:
            yield BufferPage(*row)

    def query_tensors(self) -> Generator[Tensor, None, None]:
        query = "SELECT * FROM tensors"
        rows = self.query_runner.execute_query(query)
        for row in rows:
            yield Tensor(*row)

    def query_tensors_by_tensor_ids(self, tensor_ids: List[int]) -> List[Tensor]:
        query = "SELECT * FROM tensors WHERE tensor_id IN ({})".format(
            ",".join("?" * len(tensor_ids))
        )
        rows = self.query_runner.execute_query(query, tensor_ids)
        return [Tensor(*row) for row in rows]

    def query_tensor_by_id(self, tensor_id: int) -> Optional[Tensor]:
        query = "SELECT * FROM tensors WHERE tensor_id = ?"
        rows = self.query_runner.execute_query(query, [tensor_id])
        return Tensor(*rows[0]) if rows else None

    def query_input_tensors(self) -> Generator[InputTensor, None, None]:
        query = "SELECT * FROM input_tensors"
        rows = self.query_runner.execute_query(query)
        for row in rows:
            yield InputTensor(*row)

    def query_input_tensors_by_operation_id(
        self, operation_id: int
    ) -> Generator[InputTensor, None, None]:
        query = "SELECT * FROM input_tensors WHERE operation_id = ?"
        rows = self.query_runner.execute_query(query, [operation_id])
        for row in rows:
            yield InputTensor(*row)

    def query_output_tensors(self) -> Generator[OutputTensor, None, None]:
        query = "SELECT * FROM output_tensors"
        rows = self.query_runner.execute_query(query)
        for row in rows:
            yield OutputTensor(*row)

    def query_output_tensors_by_operation_id(
        self, operation_id: int
    ) -> Generator[OutputTensor, None, None]:
        query = "SELECT * FROM output_tensors WHERE operation_id = ?"
        rows = self.query_runner.execute_query(query, [operation_id])
        for row in rows:
            yield OutputTensor(*row)

    def query_devices(self) -> Generator[Device, None, None]:
        query = "SELECT * FROM devices"
        rows = self.query_runner.execute_query(query)
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

            # TODO Remote querying currently casts single string digits as int
            if producers_data and type(producers_data) is int:
                producers_data = str(producers_data)

            if consumers_data and type(consumers_data) is int:
                consumers_data = str(consumers_data)

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

    def query_consumer_operation_ids(
        self, tensor_id: int
    ) -> Generator[int, None, None]:
        query = "SELECT * FROM input_tensors WHERE tensor_id = ?"
        rows = self.query_runner.execute_query(query, [tensor_id])
        for row in rows:
            yield row[0]

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
