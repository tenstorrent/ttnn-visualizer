# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import csv
import json
import logging
import os
import tempfile
import traceback
from io import StringIO
from pathlib import Path
from typing import (
    Dict,
    List,
    Literal,
    Optional,
    Union,
    overload,
)

import pandas as pd
import zstd
from tt_perf_report import perf_report
from ttnn_visualizer.exceptions import (
    DataFormatError,
    PerformanceReportNotLoadedException,
)
from ttnn_visualizer.models import Instance

logger = logging.getLogger(__name__)

# Cell values after NaN sanitization; matches LocalCSVQueryRunner.execute_query.
CSVCell = Optional[Union[str, float, int]]
CSVQueryResult = Union[
    List[List[CSVCell]],
    List[Dict[str, CSVCell]],
]
# Filter values are compared against the column's parsed dtype, so an int64
# column needs an int: `timer_id == "5"` matches nothing. `None` means isna().
CSVFilters = Dict[str, Optional[Union[str, int]]]

# Rows per chunk when filtering a file rather than holding it. Large enough that
# the per-chunk overhead stays negligible, small enough that a ~288 MB capture
# never lands in memory whole.
CSV_CHUNK_SIZE = 50_000


class LocalCSVQueryRunner:
    def __init__(
        self,
        file_path: Union[str, Path],
        offset: int = 0,
        max_rows: Optional[int] = None,
        stream: bool = False,
        strip_columns: bool = False,
    ):
        self.file_path = file_path
        self.offset = offset
        # Only safe when the caller wants the first N rows of the file. A query
        # that filters must see every row, or it silently answers from a prefix.
        self.max_rows = max_rows
        # Load the header only and leave the rows to `execute_filtered_query`.
        # A filter still has to see every row, but it does not have to hold them
        # all at once, and the device-log routes are not `@local_only`.
        self.stream = stream
        # Device log headers carry a leading space on every field after the
        # first. Stripping here keeps `self.df` and every chunk consistent.
        self.strip_columns = strip_columns
        self.df: Optional[pd.DataFrame] = None

    def __enter__(self):
        # Load the CSV file
        try:
            self.df = pd.read_csv(
                self.file_path,
                skiprows=self.offset,
                nrows=0 if self.stream else self.max_rows,
            )
        except (pd.errors.EmptyDataError, pd.errors.ParserError) as error:
            raise self._unparseable(error) from error

        if self.strip_columns:
            self.df.columns = self.df.columns.str.strip()
        return self

    def _unparseable(self, error: Exception) -> DataFormatError:
        """A truncated or ragged file is the caller's data, not a server fault.

        `pd.read_csv` raises `EmptyDataError` for a header-only capture and
        `ParserError` for a ragged one. Left to propagate they reach the
        catch-all as a 500 with a traceback, which is both the wrong status and
        a log the caller controls. See #1946.
        """
        return DataFormatError(
            f"{Path(self.file_path).name} could not be parsed: {error}"
        )

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.df = None

    def get_csv_header(self) -> Dict[str, int]:
        if self.df is None:
            raise RuntimeError(
                "DataFrame is not loaded. Ensure the runner is used within a context."
            )
        return {col: idx + 1 for idx, col in enumerate(self.df.columns)}

    def execute_query(
        self,
        columns: Optional[List[str]] = None,
        filters: Optional[CSVFilters] = None,
        as_dict: bool = False,
        limit: Optional[int] = None,
    ) -> CSVQueryResult:
        """
        Executes a query on the loaded DataFrame with optional limit.
        :param columns: List of columns to select.
        :param filters: Dictionary of column-value pairs to filter the rows.
        :param as_dict: Whether to return results as a list of dictionaries.
        :param limit: Maximum number of rows to return.
        :return: List of lists or dictionaries containing the result rows.
        """
        if self.df is None:
            raise RuntimeError(
                "DataFrame is not loaded. Ensure the runner is used within a context."
            )

        if self.stream:
            raise RuntimeError(
                "This runner holds only the header. Use execute_filtered_query()."
            )

        df_filtered = self._apply_filters(self.df, filters)

        # Select specified columns
        if columns:
            result_df = df_filtered[columns]
        else:
            result_df = df_filtered

        # Apply limit if specified
        if limit is not None:
            result_df = result_df.head(limit)

        return self._as_result(result_df, as_dict)

    def execute_filtered_query(
        self,
        filters: CSVFilters,
        columns: Optional[List[str]] = None,
        as_dict: bool = False,
        limit: Optional[int] = None,
    ) -> CSVQueryResult:
        """Filter the file a chunk at a time, holding only what matched.

        `execute_query` filters a frame that is already resident, so its peak
        cost is the whole file plus a copy of every matching row -- on a real
        capture, ~288 MB plus a 200k-row copy to answer with 100 rows. This
        reads `CSV_CHUNK_SIZE` rows at a time and stops as soon as `limit` rows
        have matched, so a zone that matches early never pays for the rest of
        the file. Without a `limit` it still reaches EOF, but only the matches
        accumulate. See #1946.
        """
        frames: List[pd.DataFrame] = []
        collected = 0

        try:
            chunks = pd.read_csv(
                self.file_path, skiprows=self.offset, chunksize=CSV_CHUNK_SIZE
            )
            for chunk in chunks:
                if self.strip_columns:
                    chunk.columns = chunk.columns.str.strip()

                matched = self._apply_filters(chunk, filters)
                if limit is not None:
                    matched = matched.head(limit - collected)

                if not matched.empty:
                    frames.append(matched)
                    collected += len(matched)

                if limit is not None and collected >= limit:
                    break
        except (pd.errors.EmptyDataError, pd.errors.ParserError) as error:
            raise self._unparseable(error) from error

        if not frames:
            return []

        result_df = pd.concat(frames)
        if columns:
            result_df = result_df[columns]

        return self._as_result(result_df, as_dict)

    @staticmethod
    def _apply_filters(df: pd.DataFrame, filters: Optional[CSVFilters]) -> pd.DataFrame:
        """Narrow `df` to the rows matching every column-value pair."""
        if not filters:
            return df

        for col, value in filters.items():
            if value is None:
                df = df[df[col].isna()]
            else:
                df = df[df[col] == value]

        return df

    @staticmethod
    def _as_result(result_df: pd.DataFrame, as_dict: bool) -> CSVQueryResult:
        """Sanitize NaN to None and shape the rows for the caller."""
        sanitized_df = result_df.applymap(lambda x: None if pd.isna(x) else x)

        if as_dict:
            sanitized_columns = {
                col: col.replace(" ", "_") for col in sanitized_df.columns
            }
            sanitized_df = sanitized_df.copy()
            sanitized_df.rename(columns=sanitized_columns, inplace=True)
            return sanitized_df.to_dict(orient="records")

        return sanitized_df.values.tolist()


class NPEQueries:
    NPE_FOLDER = "npe_viz"
    MANIFEST_FILE = "manifest.json"

    @staticmethod
    def get_npe_manifest(instance: Instance):
        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()
        file_path = Path(
            instance.performance_path,
            NPEQueries.NPE_FOLDER,
            NPEQueries.MANIFEST_FILE,
        )
        with open(file_path, "r") as f:
            return json.load(f)

    @staticmethod
    def get_npe_timeline(instance: Instance, filename: str):
        if not filename:
            raise ValueError("filename is required")

        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()

        file_path = Path(instance.performance_path, NPEQueries.NPE_FOLDER, filename)

        if filename.endswith(".zst"):
            with open(file_path, "rb") as file:
                compressed_data = file.read()
                uncompressed_data = zstd.uncompress(compressed_data)
                return json.loads(uncompressed_data)
        else:
            with open(file_path, "r") as f:
                return json.load(f)


class DeviceLogProfilerQueries:
    DEVICE_LOG_FILE = "profile_log_device.csv"
    # Only the columns something downstream depends on. Everything else in the
    # file is passed through untouched, because which columns exist varies by
    # producer and gating on them rejects captures that work fine: the segformer
    # demo reports have no "meta data", the smoke fixture has no "run ID", and a
    # current tt-metal adds "trace id" / "trace id counter" that none of the
    # others have.
    REQUIRED_DEVICE_LOG_COLUMNS = [
        "timer_id",  # query_by_timer_id filters on it
        "zone name",  # query_zone_statistics filters on it
        # No query here reads this one. It is the join key back to
        # `ops_perf_results` (#1941), and `PerformanceLog` declares it required,
        # so a capture without it would be served to a client expecting it.
        "run host ID",
    ]

    # The `type` column's vocabulary, as tt-metal writes it. Deliberately not
    # required -- older captures predate the column -- but pinned here so the
    # fixture tests have one list to check against rather than a copy each.
    # `scripts/smoke_test.py` keeps its own copy because it does not import
    # this package.
    DEVICE_LOG_ENTRY_TYPES = frozenset({"ZONE_START", "ZONE_END", "TS_DATA"})

    def __init__(
        self,
        instance: Instance,
        max_rows: Optional[int] = None,
        stream: bool = False,
    ):
        """Read the device log for ``instance``.

        ``max_rows`` stops `pd.read_csv` short. A real capture is ~724k rows and
        ~288 MB parsed, so a route that only ever serves the first N rows should
        pass it. A route that filters must not: `query_zone_statistics` has to
        see the whole file to know what matched.

        ``stream`` is what such a route passes instead. The header is loaded so
        the columns can still be validated, and `query_zone_statistics` walks
        the rows in chunks rather than holding them. See #1946.
        """
        self.instance = instance
        self.max_rows = max_rows
        self.stream = stream
        self.runner: Optional[LocalCSVQueryRunner] = None

    def __enter__(self):
        """
        Determine the appropriate query runner based on the instance's remote connection.
        """
        if not self.instance.performance_path:
            raise PerformanceReportNotLoadedException()
        self.runner = LocalCSVQueryRunner(
            file_path=Path(self.instance.performance_path).joinpath(
                self.DEVICE_LOG_FILE
            ),
            offset=1,  # Skip the first line for device log files
            max_rows=self.max_rows,
            stream=self.stream,
            # Every field after the first carries a leading space in the header.
            strip_columns=True,
        )

        self.runner.__enter__()

        self._require_columns(self.runner.df)

        return self

    def _require_columns(self, df: pd.DataFrame) -> None:
        """Refuse a capture whose header is missing a column we name.

        Serving a short row is how #1941 went unnoticed: the header used to be
        overwritten positionally, so a file with the right column *count* was
        relabelled rather than rejected.
        """
        missing = [
            column
            for column in self.REQUIRED_DEVICE_LOG_COLUMNS
            if column not in df.columns
        ]
        if missing:
            raise DataFormatError(
                f"{self.DEVICE_LOG_FILE} is missing expected columns: "
                f"{', '.join(missing)}"
            )

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Ensure resources are cleaned up when exiting the context.
        """
        if self.runner:
            self.runner.__exit__(exc_type, exc_val, exc_tb)

    def query_by_timer_id(self, timer_id: int, as_dict: bool = False) -> CSVQueryResult:
        """Filter rows by a specific timer_id.

        `timer_id` is an int64 column, so this takes an `int`: comparing it
        against a `str` silently matched nothing.
        """
        if self.runner is None:
            raise RuntimeError(
                "DeviceLogProfilerQueries must be used as a context manager"
            )
        return self.runner.execute_query(
            columns=[],
            filters={"timer_id": timer_id},
            as_dict=as_dict,
        )

    def query_zone_statistics(
        self, zone_name: str, as_dict: bool = False, limit: Optional[int] = None
    ) -> CSVQueryResult:
        """
        Example query: Retrieve statistics for a specific zone name.
        """
        if self.runner is None:
            raise RuntimeError(
                "DeviceLogProfilerQueries must be used as a context manager"
            )
        # Chunked: a single zone matches 200k+ rows on a real capture, and the
        # route is reachable by anyone under SERVER_MODE.
        return self.runner.execute_filtered_query(
            filters={"zone name": zone_name},
            as_dict=as_dict,
            limit=limit,
        )

    @overload
    def get_all_entries(
        self, as_dict: Literal[False] = False, limit: Optional[int] = None
    ) -> List[List[CSVCell]]: ...

    @overload
    def get_all_entries(
        self, as_dict: Literal[True], limit: Optional[int] = None
    ) -> List[Dict[str, CSVCell]]: ...

    def get_all_entries(
        self, as_dict: bool = False, limit: Optional[int] = None
    ) -> CSVQueryResult:
        """
        Fetch all entries from the device log.
        """
        if self.runner is None:
            raise RuntimeError(
                "DeviceLogProfilerQueries must be used as a context manager"
            )
        return self.runner.execute_query(columns=None, as_dict=as_dict, limit=limit)

    @staticmethod
    def get_raw_csv(instance: Instance):
        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()
        file_path = Path(
            instance.performance_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE
        )
        with open(file_path, "r") as f:
            return f.read()


class OpsPerformanceQueries:
    PERF_RESULTS_PREFIX = "ops_perf_results"

    def __init__(self, instance: Instance):
        """
        Initialize the performance profiler with a instance object.
        """
        self.instance = instance
        self.runner: Optional[LocalCSVQueryRunner] = None

    def __enter__(self):
        """

        :return:
        """
        file_path = OpsPerformanceQueries.get_local_ops_perf_file_path(self.instance)
        self.runner = LocalCSVQueryRunner(file_path=file_path, offset=0)
        self.runner.__enter__()
        self.runner.df.columns = self.runner.df.columns.str.strip()

        return self

    @staticmethod
    def get_local_ops_perf_file_path(instance):
        if not instance.performance_path:
            raise PerformanceReportNotLoadedException()
        performance_path = Path(instance.performance_path)

        # Find the latest file with the correct prefix
        perf_files = list(
            performance_path.glob(f"{OpsPerformanceQueries.PERF_RESULTS_PREFIX}.csv")
        ) + list(
            performance_path.glob(f"{OpsPerformanceQueries.PERF_RESULTS_PREFIX}_*.csv")
        )
        if not perf_files:
            raise FileNotFoundError(
                f"No performance results file found at {performance_path}"
            )

        # Use the latest file
        latest_file = max(perf_files, key=os.path.getctime)
        return str(latest_file)

    @staticmethod
    def get_remote_ops_perf_file_path(instance):
        from ttnn_visualizer.sftp_operations import resolve_file_path

        remote_profile_folder = instance.remote_profile_folder.remotePath
        return resolve_file_path(
            instance.remote_connection,
            f"{remote_profile_folder}/{OpsPerformanceQueries.PERF_RESULTS_PREFIX}*",
        )

    @staticmethod
    def get_raw_csv(instance):
        with open(OpsPerformanceQueries.get_local_ops_perf_file_path(instance)) as f:
            return f.read()

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Clean up resources when exiting the context.
        """
        if self.runner:
            self.runner.__exit__(exc_type, exc_val, exc_tb)

    def query_by_op_code(self, op_code: str, as_dict: bool = False) -> CSVQueryResult:
        """
        Query for rows with a specific OP CODE.
        """
        if self.runner is None:
            raise RuntimeError(
                "OpsPerformanceQueries must be used as a context manager"
            )
        return self.runner.execute_query(
            filters={"OP CODE": op_code}, as_dict=as_dict, columns=None
        )

    @overload
    def get_all_entries(
        self, as_dict: Literal[False] = False, limit: Optional[int] = None
    ) -> List[List[CSVCell]]: ...

    @overload
    def get_all_entries(
        self, as_dict: Literal[True], limit: Optional[int] = None
    ) -> List[Dict[str, CSVCell]]: ...

    def get_all_entries(
        self, as_dict: bool = False, limit: Optional[int] = None
    ) -> CSVQueryResult:
        """
        Fetch all entries from the performance log.
        """
        if self.runner is None:
            raise RuntimeError(
                "OpsPerformanceQueries must be used as a context manager"
            )
        return self.runner.execute_query(columns=[], as_dict=as_dict, limit=limit)

    @staticmethod
    def get_all_folders(directory: str) -> List[str]:
        """
        Get a list of all folder names in the specified directory.

        :param directory: Path to the /profiles directory.
        :return: List of folder names.
        """
        try:
            return [
                folder.name for folder in Path(directory).iterdir() if folder.is_dir()
            ]
        except Exception as e:
            raise RuntimeError(f"Error accessing directory: {e}")


class OpsPerformanceReportQueries:
    REPORT_COLUMNS = [
        "id",
        "total_percent",
        "bound",
        "op_code",
        "device",
        "device_time",
        "op_to_op_gap",
        "cores",
        "dram",
        "dram_percent",
        "flops",
        "flops_percent",
        "math_fidelity",
        "output_datatype",
        "input_0_datatype",
        "input_1_datatype",
        "dram_sharded",
        "input_0_memory",
        "inner_dim_block_size",
        "output_subblock_h",
        "output_subblock_w",
        "global_call_count",
        "advice",
        "raw_op_code",
    ]

    STACKED_REPORT_COLUMNS = [
        "%",
        "OP Code Joined",
        "Device_Time_Sum_us",
        "Ops_count",
        "Op_Category",
        "Flops_min",
        "Flops_max",
        "Flops_mean",
        "Flops_std",
        "Flops_weighted_mean",
    ]

    STACKED_REPORT_COLUMNS_WITH_DEVICE = [
        "%",
        "OP Code Joined",
        "Device",
        "Device_Time_Sum_us",
        "Ops_count",
        "Op_Category",
        "Flops_min",
        "Flops_max",
        "Flops_mean",
        "Flops_std",
        "Flops_weighted_mean",
    ]

    PASSTHROUGH_COLUMNS = {
        "pm_ideal_ns": "PM IDEAL [ns]",
        "device_kernel_duration": "DEVICE KERNEL DURATION [ns]",
        "brisc_kernel_duration": "DEVICE BRISC KERNEL DURATION [ns]",
        "ncrisc_kernel_duration": "DEVICE NCRISC KERNEL DURATION [ns]",
        "trisc0_kernel_duration": "DEVICE TRISC0 KERNEL DURATION [ns]",
        "trisc1_kernel_duration": "DEVICE TRISC1 KERNEL DURATION [ns]",
        "trisc2_kernel_duration": "DEVICE TRISC2 KERNEL DURATION [ns]",
        "erisc_kernel_duration": "DEVICE ERISC KERNEL DURATION [ns]",
    }

    DEFAULT_START_SIGNPOST = None
    DEFAULT_END_SIGNPOST = None
    DEFAULT_IGNORE_SIGNPOSTS = True
    DEFAULT_PRINT_SIGNPOSTS = True
    DEFAULT_MIN_PERCENTAGE = 0.5
    DEFAULT_ID_RANGE = None
    DEFAULT_ARCH = None
    DEFAULT_NO_ADVICE = False
    DEFAULT_TRACING_MODE = False
    DEFAULT_RAW_OP_CODES = True
    DEFAULT_NO_HOST_OPS = False
    DEFAULT_NO_STACKED_REPORT = False
    DEFAULT_NO_STACK_BY_IN0 = True
    DEFAULT_MERGE_DEVICES = True
    DEFAULT_STACKED_CSV_FILE = None  # Stacked report CSV output file
    DEFAULT_NO_SUMMARY = False
    DEFAULT_SUMMARY_FILE = None  # Stacked report output file
    DEFAULT_CLASSIC_COLORS = False  # Colour scheme for plotted stacked report
    DEFAULT_GROUP_BY = None  # Group by method for stacked report

    @staticmethod
    def extract_signposts(csv_file):
        logger.info("Reading raw CSV for signpost extraction...")
        csv_file.seek(0)
        ops_perf_results = []
        ops_perf_results_reader = csv.DictReader(csv_file)

        for row in ops_perf_results_reader:
            ops_perf_results.append(row)

        # Returns a list of unique signposts in the order they appear
        # TODO: Signpost names are not unique but tt-perf-report treats them as such
        captured_signposts = set()
        signposts = []
        for index, row in enumerate(ops_perf_results):
            if row.get("OP TYPE") == "signpost":
                op_code = row["OP CODE"]
                op_id = index + 2  # Match IDs with row numbers in ops perf results csv
                if not any(s["op_code"] == op_code for s in signposts):
                    captured_signposts.add(op_code)
                    signposts.append(
                        {
                            "id": op_id,
                            "op_code": op_code,
                        }
                    )

        return ops_perf_results, signposts

    @staticmethod
    def set_op_type_from_results(processed_row, idx, ops_perf_results):
        if 0 <= idx < len(ops_perf_results):
            processed_row["op_type"] = ops_perf_results[idx].get("OP TYPE")
        else:
            processed_row["op_type"] = None

        return processed_row

    @staticmethod
    def set_op_type_from_signposts(processed_row, signposts):
        if "op_code" in processed_row and any(
            processed_row["op_code"] in signpost["op_code"] for signpost in signposts
        ):
            processed_row["op_type"] = "signpost"
        else:
            processed_row["op_type"] = "unknown"

        return processed_row

    @staticmethod
    def cleanup_temp_files(files):
        for file in files:
            if isinstance(file, tempfile._TemporaryFileWrapper):
                file_path = file.name
            else:
                file_path = file
            if os.path.exists(file_path):
                try:
                    os.unlink(file_path)
                    logger.info(f"Deleted temporary file: {file_path}")
                except Exception as e:
                    logger.warning(f"Could not delete temporary file {file_path}: {e}")

    @staticmethod
    def set_hash_from_results(processed_row, idx, ops_perf_results):
        if 0 <= idx < len(ops_perf_results):
            hash_value = ops_perf_results[idx].get("PROGRAM HASH")
            processed_row["hash"] = hash_value if hash_value else None

            cache_hit_value = ops_perf_results[idx].get("PROGRAM CACHE HIT")
            if cache_hit_value == "True":
                processed_row["cache_hit"] = True
            elif cache_hit_value == "False":
                processed_row["cache_hit"] = False
            else:
                processed_row["cache_hit"] = None
        else:
            processed_row["hash"] = None
            processed_row["cache_hit"] = None

        return processed_row

    @classmethod
    def generate_report(cls, instance, **kwargs):
        raw_csv = OpsPerformanceQueries.get_raw_csv(instance)
        csv_file = StringIO(raw_csv)

        # Validate that we have CSV data with rows
        csv_lines = raw_csv.strip().split("\n")
        logger.info(f"CSV has {len(csv_lines)} lines (header + data rows)")

        if len(csv_lines) < 2:
            raise DataFormatError(
                f"CSV must have at least header + 1 data row, got {len(csv_lines)} lines"
            )

        # Determine if we should skip stacked report
        data_row_count = len(csv_lines) - 1
        no_stacked_report = kwargs.get(
            "no_stacked_report", cls.DEFAULT_NO_STACKED_REPORT
        )

        if data_row_count <= 1:
            logger.info("Skipping stacked report generation: insufficient data rows")
            no_stacked_report = True

        try:
            csv_summary_file = tempfile.NamedTemporaryFile(delete=False)
            csv_output_file = tempfile.NamedTemporaryFile(suffix=".csv", delete=False)
            # The perf_report library creates files with format: {csv_summary_name}.csv and {csv_summary_name}.png
            summary_csv_path = f"{csv_summary_file.name}.csv"
            summary_png_path = f"{csv_summary_file.name}.png"
            csv_summary_file.close()
            csv_output_file.close()

            start_signpost = kwargs.get("start_signpost", cls.DEFAULT_START_SIGNPOST)
            end_signpost = kwargs.get("end_signpost", cls.DEFAULT_END_SIGNPOST)
            print_signposts = kwargs.get("print_signposts", cls.DEFAULT_PRINT_SIGNPOSTS)
            no_host_ops = kwargs.get("hide_host_ops", cls.DEFAULT_NO_HOST_OPS)
            merge_devices = kwargs.get("merge_devices", cls.DEFAULT_MERGE_DEVICES)
            tracing_mode = kwargs.get("tracing_mode", cls.DEFAULT_TRACING_MODE)
            group_by = kwargs.get("group_by", cls.DEFAULT_GROUP_BY)

            if start_signpost or end_signpost:
                ignore_signposts = False
            else:
                ignore_signposts = cls.DEFAULT_IGNORE_SIGNPOSTS

            try:
                perf_report.generate_perf_report(
                    [csv_file],
                    start_signpost,
                    end_signpost,
                    ignore_signposts,
                    print_signposts,
                    cls.DEFAULT_MIN_PERCENTAGE,
                    cls.DEFAULT_ID_RANGE,
                    cls.DEFAULT_ARCH,
                    csv_output_file.name,
                    cls.DEFAULT_NO_ADVICE,
                    tracing_mode,
                    cls.DEFAULT_RAW_OP_CODES,
                    no_host_ops,
                    cls.DEFAULT_NO_SUMMARY,
                    group_by,
                    cls.DEFAULT_CLASSIC_COLORS,
                    csv_summary_file.name,
                    no_stacked_report,
                    cls.DEFAULT_NO_STACK_BY_IN0,
                    cls.DEFAULT_STACKED_CSV_FILE,
                    not merge_devices,
                )
            except Exception as e:
                logger.error(f"Error loading report: {e}")
                logger.error(f"Full traceback:\n{traceback.format_exc()}")
                raise DataFormatError(e)

            try:
                ops_perf_results, signposts = cls.extract_signposts(csv_file)
            except Exception as e:
                logger.error(f"Error extracting signposts: {e}")
                ops_perf_results = []
                signposts = []

            logger.info(f"Found {len(signposts)} signposts...")

            report = []

            try:
                logger.info(f"Processing CSV output file: {csv_output_file.name}")
                if os.path.exists(csv_output_file.name):
                    try:
                        with open(csv_output_file.name, newline="") as csvfile:
                            reader = csv.reader(csvfile, delimiter=",")
                            header = next(reader, None)

                            if not header:
                                logger.warning(
                                    "CSV output file is empty, no report data generated"
                                )
                                report = []
                            else:
                                for row in reader:
                                    try:
                                        op_id = int(row[0])
                                        # IDs in result column one correspond to row numbers in ops perf results csv
                                        idx = op_id - 2

                                        processed_row = {
                                            column: row[index]
                                            for index, column in enumerate(
                                                cls.REPORT_COLUMNS
                                            )
                                            if index < len(row)
                                        }

                                        if (
                                            "advice" in processed_row
                                            and processed_row["advice"]
                                        ):
                                            processed_row["advice"] = processed_row[
                                                "advice"
                                            ].split(" • ")
                                        else:
                                            processed_row["advice"] = []

                                        for (
                                            key,
                                            value,
                                        ) in cls.PASSTHROUGH_COLUMNS.items():
                                            if 0 <= idx < len(ops_perf_results):
                                                processed_row[key] = ops_perf_results[
                                                    idx
                                                ].get(value)
                                            else:
                                                processed_row[key] = None

                                        # Get the op type from the raw file for this row as it is not returned from tt-perf-report
                                        cls.set_op_type_from_results(
                                            processed_row, idx, ops_perf_results
                                        )

                                        cls.set_hash_from_results(
                                            processed_row, idx, ops_perf_results
                                        )

                                        report.append(processed_row)
                                    except (ValueError, IndexError) as e:
                                        logger.error(f"Error processing row {row}: {e}")
                                        continue
                    except csv.Error as e:
                        logger.error(f"CSV parsing error: {e}")
                        raise DataFormatError() from e
                else:
                    logger.warning(
                        f"CSV output file not created: {csv_output_file.name}"
                    )
            except Exception as e:
                logger.error(f"Error processing CSV output file: {e}")
                report = []

            stacked_report = []

            if not no_stacked_report:
                try:
                    logger.info(f"Processing stacked report file: {summary_csv_path}")
                    if os.path.exists(summary_csv_path):
                        try:
                            with open(summary_csv_path, newline="") as csvfile:
                                reader = csv.reader(csvfile, delimiter=",")
                                next(reader, None)

                                # Use the appropriate column list based on merge_devices flag
                                stacked_columns = (
                                    cls.STACKED_REPORT_COLUMNS_WITH_DEVICE
                                    if not merge_devices
                                    else cls.STACKED_REPORT_COLUMNS
                                )

                                for row in reader:
                                    processed_row = {
                                        column: row[index]
                                        for index, column in enumerate(stacked_columns)
                                        if index < len(row)
                                    }

                                    # Map "OP Code Joined" to "op_code" for consistency with non-stacked report
                                    if "OP Code Joined" in processed_row:
                                        processed_row["op_code"] = processed_row[
                                            "OP Code Joined"
                                        ]
                                        del processed_row["OP Code Joined"]

                                    cls.set_op_type_from_signposts(
                                        processed_row, signposts
                                    )

                                    stacked_report.append(processed_row)
                        except csv.Error as e:
                            logger.error(f"CSV parsing error in stacked report: {e}")
                            raise DataFormatError() from e
                    else:
                        logger.warning(
                            f"Stacked report file not created: {summary_csv_path}"
                        )
                except Exception as e:
                    logger.error(f"Error processing stacked report: {e}")
                    # Don't raise, just log - stacked report is optional
            else:
                logger.info("Skipping stacked report processing as per configuration")

            return {
                "report": report,
                "stacked_report": stacked_report,
                "signposts": signposts,
            }

        finally:
            # Ensure cleanup always happens, even if exceptions are raised
            cls.cleanup_temp_files(
                [csv_output_file, summary_csv_path, summary_png_path, csv_summary_file]
            )
