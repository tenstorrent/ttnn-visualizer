# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
import enum
import sqlite3
import types
from pathlib import Path
from typing import (
    AbstractSet,
    Any,
    Dict,
    Generator,
    List,
    Optional,
    Type,
    Union,
    get_args,
    get_origin,
)

from ttnn_visualizer.exceptions import (
    DatabaseFileNotFoundException,
    ProfilerReportNotLoadedException,
)
from ttnn_visualizer.models import (
    Buffer,
    BufferChunk,
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
    SourceFile,
    StackTrace,
    Tensor,
    TensorComparisonRecord,
    TensorLifetime,
)


def _python_scalar_to_sql_literal(value: Any) -> str:
    """Serialize a Python default suitable for SQLite SELECT clause literals."""
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    if isinstance(value, str):
        return "'" + value.replace("'", "''") + "'"
    if isinstance(value, enum.Enum):
        return _python_scalar_to_sql_literal(value.value)
    raise TypeError(f"Unsupported default type for SQL literal: {type(value)!r}")


def _fallback_sql_literal_for_annotation(tp: Any) -> str:
    if tp is int:
        return "0"
    if tp is float:
        return "0.0"
    if tp is bool:
        return "0"
    if tp is str:
        return "''"
    if isinstance(tp, type) and issubclass(tp, enum.Enum):
        return "0"
    origin = get_origin(tp)
    args = get_args(tp)
    if (origin is Union or origin is types.UnionType) and args:
        non_none = [a for a in args if a is not type(None)]
        if len(non_none) == 1:
            return _fallback_sql_literal_for_annotation(non_none[0])
        return "NULL"
    return "NULL"


def _sql_literal_for_missing_field(field: dataclasses.Field[Any]) -> str:
    """
    SQL expression when the report table omits a dataclass field (older schema).
    """
    if field.default is not dataclasses.MISSING:
        return _python_scalar_to_sql_literal(field.default)
    if field.default_factory is not dataclasses.MISSING:
        return _python_scalar_to_sql_literal(field.default_factory())  # type: ignore[misc]
    return _fallback_sql_literal_for_annotation(field.type)


class LocalQueryRunner:
    def __init__(self, instance: Optional[Instance] = None, connection=None):

        if connection:
            self.connection = connection
        else:
            if not instance or not instance.profiler_path:
                raise ProfilerReportNotLoadedException()
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

    def _dataclass_select_clause(
        self,
        table_name: str,
        model_cls: Type[Any],
        *,
        table_alias: Optional[str] = None,
        ignore_table_columns: Optional[AbstractSet[str]] = None,
    ) -> str:
        """
        Build ``SELECT`` expressions for ``model_cls`` fields in field order.

        Reads only columns that exist on the table (plus SQL literals for fields
        missing on older schemas). Unknown extra columns on the table are ignored,
        so TTNN can add columns without breaking the visualizer.
        """
        alias = table_alias or table_name
        raw_cols = set(self._get_table_columns(table_name))
        if ignore_table_columns:
            raw_cols -= ignore_table_columns
        parts: List[str] = []
        for field in dataclasses.fields(model_cls):
            if field.name in raw_cols:
                parts.append(f"{alias}.{field.name}")
            else:
                parts.append(_sql_literal_for_missing_field(field))
        return ", ".join(parts)

    def _query_table(
        self,
        table_name: str,
        filters: Optional[Dict[str, Union[Any, List[Any]]]] = None,
        additional_conditions: Optional[str] = None,
        additional_params: Optional[List[Any]] = None,
        columns: Optional[List[str]] = None,
        select_clause: Optional[str] = None,
    ) -> List[Any]:
        if select_clause is not None:
            columns_str = select_clause
        elif columns:
            columns_str = ", ".join(columns)
        else:
            columns_str = "*"
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
        select_clause = self._dataclass_select_clause("captured_graph", DeviceOperation)
        rows = self._query_table("captured_graph", filters, select_clause=select_clause)
        return [DeviceOperation(*row) for row in rows]

    def query_operation_arguments(
        self, filters: Optional[Dict[str, Union[Any, List[Any]]]] = None
    ) -> Generator[OperationArgument, None, None]:
        select_clause = self._dataclass_select_clause(
            "operation_arguments", OperationArgument
        )
        rows = self._query_table(
            "operation_arguments", filters, select_clause=select_clause
        )
        for row in rows:
            yield OperationArgument(*row)

    def query_operations(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Operation, None, None]:
        select_clause = self._dataclass_select_clause("operations", Operation)
        rows = self._query_table("operations", filters, select_clause=select_clause)
        for row in rows:
            yield Operation(*row)

    def query_buffers(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Buffer, None, None]:
        select_clause = self._dataclass_select_clause("buffers", Buffer)
        rows = self._query_table("buffers", filters, select_clause=select_clause)
        for row in rows:
            yield Buffer(*row)

    def query_stack_traces(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[StackTrace, None, None]:
        select_clause = self._dataclass_select_clause("stack_traces", StackTrace)
        rows = self._query_table("stack_traces", filters, select_clause=select_clause)
        for row in rows:
            yield StackTrace(*row)

    def query_source_files(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[SourceFile, None, None]:
        if not self._check_table_exists("source_files"):
            return
        select_clause = self._dataclass_select_clause("source_files", SourceFile)
        rows = self._query_table("source_files", filters, select_clause=select_clause)
        for row in rows:
            yield SourceFile(*row)

    def get_source_file_by_id(self, source_file_id: int) -> Optional[SourceFile]:
        rows = list(self.query_source_files(filters={"id": source_file_id}))
        return rows[0] if rows else None

    def get_source_file_by_path(self, path: str) -> Optional[SourceFile]:
        rows = list(self.query_source_files(filters={"path": path}))
        return rows[0] if rows else None

    def get_source_file_path_if_present(
        self,
        *,
        source_file_id: Optional[int] = None,
        file_path: Optional[str] = None,
    ) -> Optional[str]:
        """
        Return ``source_files.path`` for the first row whose ``contents`` is
        non-empty, **without** loading the (potentially large) blob.

        Used by availability probes (``GET /api/remote/stack-trace/test``) so the
        cost scales with row count, not with embedded source size. ``source_file_id``
        is preferred over ``file_path`` (mirrors ``lookup_report_source_file``).
        """
        if source_file_id is None and not file_path:
            return None
        if not self._check_table_exists("source_files"):
            return None
        if source_file_id is not None:
            rows = self.query_runner.execute_query(
                "SELECT path FROM source_files "
                "WHERE id = ? AND contents IS NOT NULL AND length(contents) > 0 "
                "LIMIT 1",
                [source_file_id],
            )
            if rows:
                return rows[0][0]
        if file_path:
            rows = self.query_runner.execute_query(
                "SELECT path FROM source_files "
                "WHERE path = ? AND contents IS NOT NULL AND length(contents) > 0 "
                "LIMIT 1",
                [file_path],
            )
            if rows:
                return rows[0][0]
        return None

    def query_error_records(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[ErrorRecord, None, None]:
        select_clause = self._dataclass_select_clause("errors", ErrorRecord)
        rows = self._query_table("errors", filters, select_clause=select_clause)
        for row in rows:
            yield ErrorRecord(*row)

    def query_tensor_comparisons(
        self, local: bool = True, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[TensorComparisonRecord, None, None]:
        if local:
            table_name = "local_tensor_comparison_records"
        else:
            table_name = "global_tensor_comparison_records"
        select_clause = self._dataclass_select_clause(
            table_name, TensorComparisonRecord
        )
        rows = self._query_table(table_name, filters, select_clause=select_clause)
        for row in rows:
            yield TensorComparisonRecord(*row)

    def query_buffer_pages(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[BufferPage, None, None]:
        select_clause = self._dataclass_select_clause("buffer_pages", BufferPage)
        rows = self._query_table("buffer_pages", filters, select_clause=select_clause)
        for row in rows:
            yield BufferPage(*row)

    def buffer_chunks_source_table(self) -> Optional[str]:
        """
        Pick the source table for per-(op, addr, bank, core) chunk reads.

        Returns ``"buffer_chunks"`` when the new pre-aggregated table is
        present, ``"buffer_pages"`` when only the legacy table exists, and
        ``None`` when neither is available.
        """
        if self._check_table_exists("buffer_chunks"):
            return "buffer_chunks"
        if self._check_table_exists("buffer_pages"):
            return "buffer_pages"
        return None

    def query_buffer_chunks(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[BufferChunk, None, None]:
        """
        Yield ``BufferChunk`` rows from whichever source table is available.

        Prefers a pre-aggregated ``buffer_chunks`` table; falls back to a
        ``GROUP BY`` aggregation over the legacy ``buffer_pages`` table.
        """
        source = self.buffer_chunks_source_table()
        if source == "buffer_chunks":
            select_clause = self._dataclass_select_clause("buffer_chunks", BufferChunk)
            rows = self._query_table(
                "buffer_chunks", filters, select_clause=select_clause
            )
            for row in rows:
                yield BufferChunk(*row)
            return
        if source == "buffer_pages":
            yield from self._aggregate_buffer_pages_to_chunks(filters)

    def _aggregate_buffer_pages_to_chunks(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[BufferChunk, None, None]:
        """
        Group ``buffer_pages`` rows into ``BufferChunk`` rows on the fly.

        Mirrors the client-side ``aggregatePagesToChunks`` fallback in
        ``src/functions/normalizeBufferPagesResponse.ts`` so both paths emit
        identical chunks: ``chunk_address = MIN(page_address)`` and
        ``chunk_size = MAX(page_address + page_size) - MIN(page_address)``
        per ``(operation_id, device_id, address, bank_id, core_x, core_y,
        buffer_type[, rank])``.
        """
        page_columns = set(self._get_table_columns("buffer_pages"))
        has_rank = "rank" in page_columns

        where_parts: List[str] = ["1=1"]
        params: List[Any] = []
        if filters:
            for column, value in filters.items():
                if value is None:
                    continue
                if isinstance(value, list):
                    if not value:
                        continue
                    placeholders = ", ".join(["?"] * len(value))
                    where_parts.append(f"{column} IN ({placeholders})")
                    params.extend(value)
                else:
                    where_parts.append(f"{column} = ?")
                    params.append(value)
        where_clause = " AND ".join(where_parts)

        rank_select = "rank" if has_rank else "0"
        rank_group = ", rank" if has_rank else ""

        query = f"""
            SELECT
                operation_id,
                device_id,
                address,
                bank_id,
                core_x,
                core_y,
                MIN(page_address) AS chunk_address,
                MAX(page_address + page_size) - MIN(page_address) AS chunk_size,
                MAX(page_size) AS page_size,
                COUNT(*) AS num_pages,
                buffer_type,
                {rank_select} AS rank
            FROM buffer_pages
            WHERE {where_clause}
            GROUP BY
                operation_id, device_id, address,
                bank_id, core_x, core_y, buffer_type{rank_group}
        """

        rows = self.query_runner.execute_query(query, params)
        for row in rows:
            yield BufferChunk(*row)

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
        select_clause = self._dataclass_select_clause("input_tensors", InputTensor)
        rows = self._query_table("input_tensors", filters, select_clause=select_clause)
        for row in rows:
            yield InputTensor(*row)

    def query_output_tensors(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[OutputTensor, None, None]:
        select_clause = self._dataclass_select_clause("output_tensors", OutputTensor)
        rows = self._query_table("output_tensors", filters, select_clause=select_clause)
        for row in rows:
            yield OutputTensor(*row)

    def query_devices(
        self, filters: Optional[Dict[str, Any]] = None
    ) -> Generator[Device, None, None]:
        select_clause = self._dataclass_select_clause(
            "devices",
            Device,
            ignore_table_columns=frozenset({"num_storage_cores"}),
        )
        rows = self._query_table("devices", filters, select_clause=select_clause)
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
        col_sql = self._dataclass_select_clause(
            "buffers", Buffer, table_alias="buffers"
        )
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
        return Buffer(*rows[0]) if rows else None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        if isinstance(self.query_runner, LocalQueryRunner):
            self.query_runner.close()
