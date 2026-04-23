# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
import sqlite3
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Union

from ttnn_visualizer.exceptions import DatabaseFileNotFoundException
from ttnn_visualizer.models import (
    Buffer,
    BufferPage,
    Device,
    DeviceOperation,
    ErrorRecord,
    InputTensor,
    Instance,
    Operation,
    OperationArgument,
    OutputTensor,
    ProducersConsumers,
    StackTrace,
    Tensor,
    TensorComparisonRecord,
    TensorLifetime,
)


def _buffer_from_row(row: tuple) -> Buffer:
    n = len(row)
    if n == 5:
        return Buffer(row[0], row[1], row[2], row[3], row[4], None, 0)
    if n == 6:
        return Buffer(row[0], row[1], row[2], row[3], row[4], row[5], 0)
    if n == 7:
        return Buffer(row[0], row[1], row[2], row[3], row[4], row[5], row[6])
    raise ValueError(f"Unexpected buffers row width: {n}")


def _stack_trace_from_row(row: tuple) -> StackTrace:
    if len(row) == 2:
        return StackTrace(row[0], stack_trace=row[1], rank=0)
    return StackTrace(row[0], stack_trace=row[1], rank=row[2])


def _error_record_from_row(row: tuple) -> ErrorRecord:
    if len(row) == 6:
        return ErrorRecord(row[0], row[1], row[2], row[3], row[4], row[5], rank=0)
    return ErrorRecord(*row)


def _buffer_page_from_row(row: tuple) -> BufferPage:
    if len(row) == 10:
        return BufferPage(
            row[0],
            row[1],
            row[2],
            row[3],
            row[4],
            row[5],
            row[6],
            row[7],
            row[8],
            row[9],
            rank=0,
        )
    return BufferPage(*row)


def _operation_argument_from_row(row: tuple) -> OperationArgument:
    if len(row) == 3:
        return OperationArgument(row[0], row[1], row[2], 0)
    return OperationArgument(*row)


def _operation_from_row(row: tuple) -> Operation:
    if len(row) == 3:
        return Operation(row[0], row[1], row[2], 0)
    return Operation(*row)


def _device_operation_from_row(row: tuple) -> DeviceOperation:
    if len(row) == 2:
        return DeviceOperation(row[0], row[1], 0)
    return DeviceOperation(*row)


def _input_tensor_from_row(row: tuple) -> InputTensor:
    if len(row) == 3:
        return InputTensor(row[0], row[1], row[2], 0)
    return InputTensor(*row)


def _output_tensor_from_row(row: tuple) -> OutputTensor:
    if len(row) == 3:
        return OutputTensor(row[0], row[1], row[2], 0)
    return OutputTensor(*row)


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

    def _get_table_columns(self, table_name: str) -> List[str]:
        """
        Gets the list of column names for a table.
        """
        query = f"PRAGMA table_info({table_name})"
        rows = self.query_runner.execute_query(query)
        return [row[1] for row in rows]  # row[1] is the column name

    def _query_table(
        self,
        table_name: str,
        filters: Optional[Dict[str, Union[Any, List[Any]]]] = None,
        additional_conditions: Optional[str] = None,
        additional_params: Optional[List[Any]] = None,
        columns: Optional[List[str]] = None,
    ) -> List[Any]:
        columns_str = ", ".join(columns) if columns else "*"
        query = f"SELECT {columns_str} FROM {table_name} WHERE 1=1"
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

    def merge_rank_filter(
        self,
        table_name: str,
        filters: Optional[Dict[str, Any]],
        rank: Optional[int],
    ) -> Dict[str, Any]:
        """
        Return a copy of filters with rank = rank if the table has a rank column.
        No-op when rank is None or the schema has no rank (old reports).
        """
        out = dict(filters or {})
        if rank is None:
            return out
        if not self._check_table_exists(table_name):
            return out
        if "rank" not in self._get_table_columns(table_name):
            return out
        out["rank"] = rank
        return out

    def report_has_rank_column(self) -> bool:
        """
        True if the report DB uses the multi-host schema (``rank`` on ``operations``).
        Used to reject ``?rank=N`` (N != 0) on legacy databases that only represent rank 0.
        """
        if not self._check_table_exists("operations"):
            return False
        return "rank" in self._get_table_columns("operations")

    def query_device_operations(
        self, filters: Optional[Dict[str, Union[Any, List[Any]]]] = None
    ) -> List[DeviceOperation]:
        if not self._check_table_exists("captured_graph"):
            return []
        rows = self._query_table("captured_graph", filters)
        return [_device_operation_from_row(row) for row in rows]

    def query_operation_arguments(
        self, filters: Optional[Dict[str, Union[Any, List[Any]]]] = None
    ) -> Generator[OperationArgument, None, None]:
        rows = self._query_table("operation_arguments", filters)
        for row in rows:
            yield _operation_argument_from_row(row)

    def query_operations(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Operation, None, None]:
        rows = self._query_table("operations", filters)
        for row in rows:
            yield _operation_from_row(row)

    def query_buffers(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Buffer, None, None]:
        rows = self._query_table("buffers", filters)
        for row in rows:
            yield _buffer_from_row(row)

    def query_stack_traces(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[StackTrace, None, None]:
        rows = self._query_table("stack_traces", filters)
        for row in rows:
            yield _stack_trace_from_row(row)

    def query_error_records(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[ErrorRecord, None, None]:
        rows = self._query_table("errors", filters)
        for row in rows:
            yield _error_record_from_row(row)

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
            yield _buffer_page_from_row(row)

    def query_tensors(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Tensor, None, None]:
        tensor_columns = self._get_table_columns("tensors")
        size_on_tensors = "size" in tensor_columns
        rank_on_tensors = "rank" in tensor_columns

        device_tensors_exists = self._check_table_exists("device_tensors")
        tensor_lifetime_exists = self._check_table_exists("tensor_lifetime")
        dt_rank = device_tensors_exists and "rank" in self._get_table_columns(
            "device_tensors"
        )
        it_rank = "rank" in self._get_table_columns("input_tensors")
        ot_rank = "rank" in self._get_table_columns("output_tensors")
        buf_rank = "rank" in self._get_table_columns("buffers")

        it_join = "it.tensor_id = t.tensor_id"
        if it_rank and rank_on_tensors:
            it_join += " AND it.rank = t.rank"
        ot_join = "ot.tensor_id = t.tensor_id"
        if ot_rank and rank_on_tensors:
            ot_join += " AND ot.rank = t.rank"

        buf_join = (
            "b.operation_id = COALESCE(it.operation_id, ot.operation_id) "
            "AND t.address = b.address AND t.device_id = b.device_id"
        )
        if buf_rank and rank_on_tensors:
            buf_join += " AND b.rank = t.rank"

        dt_join = "dt.tensor_id = t.tensor_id"
        if dt_rank and rank_on_tensors:
            dt_join += " AND dt.rank = t.rank"

        select_core = """
                        t.tensor_id, t.shape, t.dtype, t.layout, t.memory_config,
                        t.device_id, t.address, t.buffer_type"""
        select_parts = [select_core.strip()]
        if rank_on_tensors:
            select_parts.append("t.rank")
        if size_on_tensors:
            select_parts.append("t.size")
        else:
            select_parts.append("b.max_size_per_bank AS size")

        if device_tensors_exists:
            select_parts.append(
                "GROUP_CONCAT(dt.device_id || ':' || dt.address, ',') AS device_tensors_data"
            )
        else:
            select_parts.append("NULL AS device_tensors_data")

        if tensor_lifetime_exists:
            select_parts.extend(
                [
                    "tl.producer_operation_id",
                    "tl.last_use_operation_id",
                    "tl.deallocate_operation_id",
                    "tl.producer_source_file",
                    "tl.producer_source_line",
                    "tl.last_use_source_file",
                    "tl.last_use_source_line",
                ]
            )
        else:
            select_parts.extend(
                [
                    "NULL AS producer_operation_id",
                    "NULL AS last_use_operation_id",
                    "NULL AS deallocate_operation_id",
                    "NULL AS producer_source_file",
                    "NULL AS producer_source_line",
                    "NULL AS last_use_source_file",
                    "NULL AS last_use_source_line",
                ]
            )

        select_sql = ",\n                        ".join(select_parts)

        group_by = "t.tensor_id"
        if rank_on_tensors:
            group_by += ", t.rank"

        if size_on_tensors:
            join_lines = []
            if device_tensors_exists:
                join_lines.append(f"LEFT JOIN device_tensors dt ON {dt_join}")
            if tensor_lifetime_exists:
                join_lines.append(
                    "LEFT JOIN tensor_lifetime tl ON tl.tensor_id = t.tensor_id"
                )
            join_sql = (
                "\n                    " + "\n                    ".join(join_lines)
                if join_lines
                else ""
            )
            query = f"""
                    SELECT
                        {select_sql}
                    FROM tensors t{join_sql}
                    WHERE 1=1
                """
        else:
            join_lines = [
                f"LEFT JOIN input_tensors it ON {it_join}",
                f"LEFT JOIN output_tensors ot ON {ot_join}",
                f"LEFT JOIN buffers b ON {buf_join}",
            ]
            if device_tensors_exists:
                join_lines.append(f"LEFT JOIN device_tensors dt ON {dt_join}")
            if tensor_lifetime_exists:
                join_lines.append(
                    "LEFT JOIN tensor_lifetime tl ON tl.tensor_id = t.tensor_id"
                )
            join_sql = "\n                    " + "\n                    ".join(
                join_lines
            )
            query = f"""
                    SELECT
                        {select_sql}
                    FROM tensors t
                    {join_sql}
                    WHERE 1=1
                """
        params: List[Any] = []

        if filters:
            for column, value in filters.items():
                if value is None:
                    continue

                if isinstance(value, list):
                    if len(value) == 0:
                        continue
                    placeholders = ", ".join(["?"] * len(value))
                    query += f" AND t.{column} IN ({placeholders})"
                    params.extend(value)
                else:
                    query += f" AND t.{column} = ?"
                    params.append(value)

        query += f" GROUP BY {group_by}"

        rows = self.query_runner.execute_query(query, params)
        for row in rows:
            i = 8
            rank_val = row[i] if rank_on_tensors else 0
            if rank_on_tensors:
                i += 1
            size = row[i]
            i += 1
            device_tensors_data = row[i]
            i += 1

            # Lifetime columns are always present in the SELECT (either real or NULL).
            (
                producer_operation_id,
                last_use_operation_id,
                deallocate_operation_id,
                producer_source_file,
                producer_source_line,
                last_use_source_file,
                last_use_source_line,
            ) = row[i : i + 7]

            # Only build a TensorLifetime object when the LEFT JOIN produced at
            # least one non-NULL value, i.e. this tensor has a lifetime row.
            # An all-NULL result means the table exists but has no entry for
            # this tensor_id, so we keep lifetime=None to avoid sending empty
            # objects for every unmatched tensor in large responses.
            lifetime: Optional[TensorLifetime] = None
            lifetime_values = (
                producer_operation_id,
                last_use_operation_id,
                deallocate_operation_id,
                producer_source_file,
                producer_source_line,
                last_use_source_file,
                last_use_source_line,
            )
            if tensor_lifetime_exists and any(v is not None for v in lifetime_values):
                lifetime = TensorLifetime(
                    producer_operation_id=producer_operation_id,
                    last_use_operation_id=last_use_operation_id,
                    deallocate_operation_id=deallocate_operation_id,
                    producer_source_file=producer_source_file,
                    producer_source_line=producer_source_line,
                    last_use_source_file=last_use_source_file,
                    last_use_source_line=last_use_source_line,
                )

            device_addresses: List[Any] = []

            if device_tensors_data:
                pairs = device_tensors_data.split(",")
                device_tensor_list = []
                for pair in pairs:
                    if pair:
                        device_id_str, address_str = pair.split(":")
                        device_id = int(device_id_str)
                        address = int(address_str)
                        device_tensor_list.append((device_id, address))

                for device_id, address in sorted(
                    device_tensor_list, key=lambda x: x[0]
                ):
                    while len(device_addresses) < device_id:
                        device_addresses.append(None)
                    device_addresses.append(address)

            yield Tensor(
                row[0],
                row[1],
                row[2],
                row[3],
                row[4],
                row[5],
                row[6],
                row[7],
                device_addresses,
                size=size,
                lifetime=lifetime,
                rank=rank_val,
            )

    def query_input_tensors(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[InputTensor, None, None]:
        rows = self._query_table("input_tensors", filters)
        for row in rows:
            yield _input_tensor_from_row(row)

    def query_output_tensors(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[OutputTensor, None, None]:
        rows = self._query_table("output_tensors", filters)
        for row in rows:
            yield _output_tensor_from_row(row)

    def query_devices(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Device, None, None]:
        # Get the expected Device model field names in order
        device_fields = [field.name for field in dataclasses.fields(Device)]

        # Get all columns from the devices table
        all_columns = self._get_table_columns("devices")

        # Filter out num_storage_cores if it exists (for backwards compatibility)
        # and ensure columns are in the order expected by the Device model
        available_columns = set(all_columns) - {"num_storage_cores"}
        columns = [col for col in device_fields if col in available_columns]

        rows = self._query_table("devices", filters, columns=columns)

        for row in rows:
            yield Device(*row)

    def query_producers_consumers(
        self, rank: Optional[int] = None
    ) -> Generator[ProducersConsumers, None, None]:
        rank_on_tensors = "rank" in self._get_table_columns("tensors")
        it_rank = "rank" in self._get_table_columns("input_tensors")
        ot_rank = "rank" in self._get_table_columns("output_tensors")

        it_join = "it.tensor_id = t.tensor_id"
        if it_rank and rank_on_tensors:
            it_join += " AND it.rank = t.rank"
        ot_join = "ot.tensor_id = t.tensor_id"
        if ot_rank and rank_on_tensors:
            ot_join += " AND ot.rank = t.rank"

        rank_select = ", t.rank" if rank_on_tensors else ""
        group_by = "t.tensor_id" + (", t.rank" if rank_on_tensors else "")

        where_sql = "WHERE 1=1"
        params: List[Any] = []
        if rank_on_tensors and rank is not None:
            where_sql += " AND t.rank = ?"
            params.append(rank)

        query = f"""
            SELECT
                t.tensor_id{rank_select},
                GROUP_CONCAT(ot.operation_id, ', ') AS consumers,
                GROUP_CONCAT(it.operation_id, ', ') AS producers
            FROM
                tensors t
            LEFT JOIN
                input_tensors it ON {it_join}
            LEFT JOIN
                output_tensors ot ON {ot_join}
            {where_sql}
            GROUP BY
                {group_by}
        """
        rows = self.query_runner.execute_query(query, params)
        for row in rows:
            # SQL aliases: ot AS "consumers", it AS "producers" (names are swapped vs semantics).
            if rank_on_tensors:
                tensor_id, rank_val, producers_data, consumers_data = row
            else:
                tensor_id, producers_data, consumers_data = row
                rank_val = 0
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
            yield ProducersConsumers(tensor_id, producers, consumers, rank_val)

    def query_report_metadata(
        self,
    ) -> list[tuple[str, str | None]]:
        """
        Returns all rows from report_metadata (key, value).
        Caller must ensure the table exists (e.g. via _check_table_exists).
        """
        rows = self._query_table("report_metadata", columns=["key", "value"])
        return rows

    def query_next_buffer(
        self, operation_id: int, address: str, rank: Optional[int] = None
    ) -> Optional[Buffer]:
        buf_cols = self._get_table_columns("buffers")
        ordered = [
            c
            for c in (
                "operation_id",
                "device_id",
                "address",
                "max_size_per_bank",
                "buffer_type",
                "buffer_layout",
                "rank",
            )
            if c in buf_cols
        ]
        col_sql = ", ".join(f"buffers.{c}" for c in ordered)
        where_extra = ""
        params: List[Any] = [address, operation_id]
        if rank is not None and "rank" in buf_cols:
            where_extra = " AND buffers.rank = ?"
            params.append(rank)
        query = f"""
            SELECT
                {col_sql}
            FROM
                buffers
            WHERE
                buffers.address = ?
                AND buffers.operation_id > ?{where_extra}
            ORDER BY buffers.operation_id
        """
        rows = self.query_runner.execute_query(query, params)
        return _buffer_from_row(rows[0]) if rows else None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if isinstance(self.query_runner, LocalQueryRunner):
            self.query_runner.close()
