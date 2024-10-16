import sqlite3
from typing import List, Optional, Generator

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


class DatabaseQueries:
    def __init__(self, db_path: str = None, connection=None):

        if db_path is not None and connection is not None:
            raise ValueError(
                "Invalid arguments, specify either existing connection or path"
            )
        if not connection:
            self.connection = sqlite3.connect(db_path, isolation_level=None, timeout=30)
        else:
            self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.connection.close()

    def _get_cursor(self) -> sqlite3.Cursor:
        return self.connection.cursor()

    def _check_table_exists(self, cursor: sqlite3.Cursor, table_name: str) -> bool:
        query = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?"
        cursor.execute(query, (table_name,))
        result = cursor.fetchone()
        return bool(result)

    def query_device_operations(self) -> List[DeviceOperation]:
        cursor = self._get_cursor()
        try:
            if self._check_table_exists(cursor, "captured_graph"):
                cursor.execute("SELECT * FROM captured_graph")
                return [DeviceOperation(*row) for row in cursor.fetchall()]
            return []
        finally:
            cursor.close()

    def query_device_operations_by_operation_id(
        self, operation_id: int
    ) -> Optional[DeviceOperation]:
        cursor = self._get_cursor()
        try:
            device_operation = None
            query = "SELECT * FROM captured_graph WHERE operation_id = ?"
            if self._check_table_exists(cursor, "captured_graph"):
                cursor.execute(query, (operation_id,))
                result = cursor.fetchone()
                if result:
                    operation_id, captured_graph = result
                    device_operation = DeviceOperation(
                        operation_id=operation_id, captured_graph=captured_graph
                    )
            return device_operation
        finally:
            cursor.close()

    def query_operations(self) -> Generator[Operation, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM operations")
            for row in cursor.fetchall():
                yield Operation(*row)
        finally:
            cursor.close()

    def query_operation_by_id(self, operation_id: int) -> Optional[Operation]:
        cursor = self._get_cursor()
        try:
            cursor.execute(
                "SELECT * FROM operations WHERE operation_id = ?", (operation_id,)
            )
            row = cursor.fetchone()
            return Operation(*row) if row else None
        finally:
            cursor.close()

    def query_operation_arguments(self) -> Generator[OperationArgument, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM operation_arguments")
            for row in cursor.fetchall():
                yield OperationArgument(*row)
        finally:
            cursor.close()

    def query_operation_arguments_by_operation_id(
        self, operation_id: int
    ) -> Generator[OperationArgument, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute(
                "SELECT * FROM operation_arguments WHERE operation_id = ?",
                (operation_id,),
            )
            for row in cursor.fetchall():
                yield OperationArgument(*row)
        finally:
            cursor.close()

    def query_stack_traces(self) -> Generator[StackTrace, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM stack_traces")
            for row in cursor.fetchall():
                operation_id, stack_trace = row
                yield StackTrace(operation_id, stack_trace=stack_trace)
        finally:
            cursor.close()

    def query_stack_trace(self, operation_id: int) -> Optional[str]:
        cursor = self._get_cursor()
        try:
            cursor.execute(
                "SELECT * FROM stack_traces WHERE operation_id = ?", (operation_id,)
            )
            result = cursor.fetchone()
            if result:
                operation_id, stack_trace = result
                return StackTrace(operation_id, stack_trace=stack_trace)
        finally:
            cursor.close()

    def query_buffers(
        self, buffer_type: Optional[str] = None
    ) -> Generator[Buffer, None, None]:
        cursor = self._get_cursor()
        try:
            # noinspection SqlConstantExpression
            query = "SELECT * FROM buffers WHERE 1=1"
            params = []

            if buffer_type is not None:
                query += " AND buffer_type = ?"
                params.append(buffer_type)

            # Execute the query
            cursor.execute(query, params)

            for row in cursor.fetchall():
                yield Buffer(*row)

        finally:
            cursor.close()

    def query_buffers_by_operation_id(
        self, operation_id: int, buffer_type: Optional[str] = None
    ) -> Generator[Buffer, None, None]:
        cursor = self._get_cursor()
        try:
            query = "SELECT * FROM buffers WHERE operation_id = ?"
            params = [operation_id]

            if buffer_type is not None:
                query += " AND buffer_type = ?"
                params.append(buffer_type)

            cursor.execute(query, params)

            for row in cursor.fetchall():
                yield Buffer(*row)

        finally:
            cursor.close()

    def query_buffer_pages(
        self,
        operation_id: Optional[int] = None,
        address: Optional[int] = None,
        buffer_type: Optional[int] = None,
    ) -> Generator[BufferPage, None, None]:
        cursor = self._get_cursor()
        try:
            # noinspection SqlConstantExpression
            query = "SELECT * FROM buffer_pages WHERE 1=1"
            params = []

            # Add optional conditions
            if operation_id is not None:
                query += " AND operation_id = ?"
                params.append(operation_id)

            if address is not None:
                query += " AND address = ?"
                params.append(address)

            if buffer_type is not None:
                query += " AND buffer_type = ?"
                params.append(buffer_type)

            # Execute the query
            cursor.execute(query, params)

            for row in cursor.fetchall():
                yield BufferPage(*row)

        finally:
            cursor.close()

    def query_tensors(self) -> Generator[Tensor, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM tensors")
            for row in cursor.fetchall():
                yield Tensor(*row)
        finally:
            cursor.close()

    def query_tensors_by_tensor_ids(self, tensor_ids: List[int]) -> List[Tensor]:
        cursor = self._get_cursor()
        query = "SELECT * FROM tensors WHERE tensor_id IN ({})".format(
            ",".join("?" * len(tensor_ids))
        )
        cursor.execute(query, tensor_ids)
        return [Tensor(*row) for row in cursor.fetchall()]

    def query_tensor_by_id(self, tensor_id: int) -> Optional[Tensor]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM tensors WHERE tensor_id = ?", (tensor_id,))
            row = cursor.fetchone()
            return Tensor(*row) if row else None
        finally:
            cursor.close()

    def query_input_tensors(self) -> Generator[InputTensor, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM input_tensors")
            for row in cursor.fetchall():
                yield InputTensor(*row)
        finally:
            cursor.close()

    def query_input_tensors_by_operation_id(
        self, operation_id: int
    ) -> Generator[InputTensor, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute(
                "SELECT * FROM input_tensors WHERE operation_id = ?", (operation_id,)
            )
            for row in cursor.fetchall():
                yield InputTensor(*row)
        finally:
            cursor.close()

    def query_output_tensors(self) -> Generator[OutputTensor, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM output_tensors")
            for row in cursor.fetchall():
                yield OutputTensor(*row)
        finally:
            cursor.close()

    def query_output_tensors_by_operation_id(
        self, operation_id: int
    ) -> Generator[OutputTensor, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute(
                "SELECT * FROM output_tensors WHERE operation_id = ?", (operation_id,)
            )
            for row in cursor.fetchall():
                yield OutputTensor(*row)
        finally:
            cursor.close()

    def query_devices(self) -> Generator[Device, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute("SELECT * FROM devices")
            for row in cursor.fetchall():
                yield Device(*row)
        finally:
            cursor.close()

    def query_producers_consumers(self) -> Generator[ProducersConsumers, None, None]:
        cursor = self._get_cursor()
        try:
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
                tensor_id, producers_data, consumers_data = row
                producers = sorted(
                    set(map(int, producers_data.split(","))) if producers_data else []
                )
                consumers = sorted(
                    set(map(int, consumers_data.split(","))) if consumers_data else []
                )
                yield ProducersConsumers(tensor_id, producers, consumers)
        finally:
            cursor.close()

    def query_consumer_operation_ids(
        self, tensor_id: int
    ) -> Generator[int, None, None]:
        cursor = self._get_cursor()
        try:
            cursor.execute(
                "SELECT * FROM input_tensors WHERE tensor_id = ?", (tensor_id,)
            )
            for row in cursor.fetchall():
                yield row[0]  # Assuming operation_id is the first column
        finally:
            cursor.close()

    def query_next_buffer(self, operation_id: int, address: str) -> Optional[Buffer]:
        cursor = self._get_cursor()
        try:
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
            cursor.execute(query, (address, operation_id))
            row = cursor.fetchone()
            return Buffer(*row) if row else None
        finally:
            cursor.close()
