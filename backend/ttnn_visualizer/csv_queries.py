# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.
import csv
import os
import tempfile
from io import StringIO
from pathlib import Path
from typing import List, Dict, Union, Optional

import pandas as pd
from tt_perf_report import perf_report

from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.models import TabSession
from ttnn_visualizer.ssh_client import get_client


class LocalCSVQueryRunner:
    def __init__(self, file_path: str, offset: int = 0):
        self.file_path = file_path
        self.offset = offset
        self.df: Optional[pd.DataFrame] = None

    def __enter__(self):
        # Load the CSV file
        self.df = pd.read_csv(self.file_path, skiprows=self.offset)
        return self

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
        columns: List[str],
        filters: Dict[str, Union[str, None]] = None,
        as_dict: bool = False,
        limit: int = None,
    ) -> Union[
        List[List[Optional[Union[str, float, int]]]],
        List[Dict[str, Optional[Union[str, float, int]]]],
    ]:
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

        # Apply filters if provided
        df_filtered = self.df
        if filters:
            for col, value in filters.items():
                if value is None:
                    df_filtered = df_filtered[df_filtered[col].isna()]
                else:
                    df_filtered = df_filtered[df_filtered[col] == value]

        # Select specified columns
        if columns:
            result_df = df_filtered[columns]
        else:
            result_df = df_filtered

        # Apply limit if specified
        if limit is not None:
            result_df = result_df.head(limit)

        # Replace NaN with None in the query results
        sanitized_df = result_df.applymap(lambda x: None if pd.isna(x) else x)

        if as_dict:
            sanitized_columns = {
                col: col.replace(" ", "_") for col in sanitized_df.columns
            }
            sanitized_df = sanitized_df.copy()
            sanitized_df.rename(columns=sanitized_columns, inplace=True)
            return sanitized_df.to_dict(orient="records")

        return sanitized_df.values.tolist()


class RemoteCSVQueryRunner:
    def __init__(
        self, file_path: str, remote_connection, sep: str = ",", offset: int = 0
    ):
        """
        Initialize the RemoteCSVQueryRunner.

        :param file_path: Path to the remote file.
        :param remote_connection: RemoteConnection object for SSH access.
        :param sep: Separator used in the CSV file.
        :param offset: Number of lines to skip before treating the first valid line as headers.
        """
        self.file_path = file_path
        self.remote_connection = remote_connection
        self.sep = sep
        self.offset = offset
        self.ssh_client = get_client(remote_connection)

    def execute_query(
        self,
        filters: Optional[Dict[str, str]] = None,  # Allow unsanitized filter keys
        as_dict: bool = False,  # Convert rows to dictionaries if True
        limit: int = None,
        columns=None,
    ) -> Union[List[List[str]], List[Dict[str, str]]]:
        """
        Fetch rows with optional filtering and limit, returning either raw rows or dictionaries.
        :param filters: Dictionary of unsanitized column filters (e.g., {"zone name": "BRISC-FW"}).
        :param as_dict: Whether to return results as a list of dictionaries.
        :param limit: Maximum number of rows to return.
        :return: List of rows as lists or dictionaries.
        """
        # Fetch header row, accounting for the offset
        header_cmd = f"head -n {self.offset + 1} {self.file_path} | tail -n 1"
        stdin, stdout, stderr = self.ssh_client.exec_command(header_cmd)
        raw_header = stdout.read().decode("utf-8").strip()
        error = stderr.read().decode("utf-8").strip()

        if error:
            raise RuntimeError(f"Error fetching header row: {error}")

        # Sanitize headers
        headers = [
            col.strip().replace(" ", "_").lower() for col in raw_header.split(self.sep)
        ]

        # Build the AWK command for filtering
        awk_filter = ""
        if filters:
            filter_conditions = []
            for unsanitized_col, value in filters.items():
                # Sanitize the filter key
                sanitized_col = unsanitized_col.strip().replace(" ", "_").lower()
                if sanitized_col in headers:
                    col_idx = headers.index(sanitized_col) + 1
                    filter_conditions.append(f'${col_idx} == "{value}"')
                else:
                    print(
                        f"WARNING: Column '{unsanitized_col}' (sanitized: '{sanitized_col}') not found in headers."
                    )
            awk_filter = " && ".join(filter_conditions)

        # Build AWK command
        limit_clause = f"| head -n {limit}" if limit else ""
        awk_cmd = f"awk -F'{self.sep}' 'NR > {self.offset + 1} {f'&& {awk_filter}' if awk_filter else ''} {{print}}' {self.file_path} {limit_clause}"

        stdin, stdout, stderr = self.ssh_client.exec_command(awk_cmd)
        output = stdout.read().decode("utf-8").strip()
        error = stderr.read().decode("utf-8").strip()

        if error:
            raise RuntimeError(f"Error executing AWK command: {error}")

        # Split rows into lists of strings
        rows = [
            [field.strip().strip('"') for field in line.split(self.sep)]
            for line in output.splitlines()
        ]
        if as_dict:
            # Convert rows to dictionaries
            result = [dict(zip(headers, row)) for row in rows]

            if columns:
                sanitized_columns = [
                    col.strip().replace(" ", "_").lower() for col in columns
                ]
                result = [
                    {
                        key: value
                        for key, value in row.items()
                        if key in sanitized_columns
                    }
                    for row in result
                ]
                print(f"DEBUG: Filtered columns: {sanitized_columns}")
            return result
        return rows

    def execute_query_raw(self, limit: int = None) -> List[str]:
        """
        Fetch raw lines from the remote CSV file, accounting for the offset.

        :param limit: Maximum number of rows to fetch (including offset rows).
        :return: List of raw rows as strings.
        """
        total_lines = self.offset + limit if limit else ""
        cmd = (
            f"head -n {total_lines} {self.file_path}"
            if total_lines
            else f"cat {self.file_path}"
        )
        stdin, stdout, stderr = self.ssh_client.exec_command(cmd)
        output = stdout.read().decode("utf-8").strip()
        error = stderr.read().decode("utf-8").strip()

        if error:
            raise RuntimeError(f"Error fetching raw rows: {error}")

        return output.splitlines()[self.offset :]

    def get_csv_header(self) -> Dict[str, int]:
        """
        Retrieve the CSV headers as a dictionary mapping column names to their indices (1-based).
        :return: Dictionary of headers.
        """
        header_cmd = f"head -n {self.offset + 1} {self.file_path} | tail -n 1"
        stdin, stdout, stderr = self.ssh_client.exec_command(header_cmd)
        header = stdout.read().decode("utf-8").strip()
        error = stderr.read().decode("utf-8").strip()

        if error:
            raise RuntimeError(f"Error reading CSV header: {error}")

        # Trim spaces in header names
        column_names = [name.strip() for name in header.split(self.sep)]
        return {name: idx + 1 for idx, name in enumerate(column_names)}

    def build_awk_filter(
        self, column_indices: Dict[str, int], filters: Dict[str, str]
    ) -> str:
        if not filters:
            return ""
        conditions = [
            f'${column_indices[col]} == "{val}"' for col, val in filters.items()
        ]
        return " && ".join(conditions)

    def build_awk_columns(
        self, column_indices: Dict[str, int], columns: List[str]
    ) -> str:
        return ", ".join([f"${column_indices[col]}" for col in columns])

    def __enter__(self):
        """
        Enable usage with context management.
        """
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Clean up the SSH connection when exiting context.
        """
        if self.ssh_client:
            self.ssh_client.close()


class DeviceLogProfilerQueries:
    DEVICE_LOG_FILE = "profile_log_device.csv"
    LOCAL_PROFILER_DIRECTORY = "profiler"
    DEVICE_LOG_COLUMNS = [
        "PCIe slot",
        "core_x",
        "core_y",
        "RISC processor type",
        "timer_id",
        "time[cycles since reset]",
        "stat value",
        "run ID",
        "run host ID",
        "zone name",
        "zone phase",
        "source line",
        "source file",
    ]

    def __init__(self, session: TabSession):
        """
        Initialize the profiler with a session object.
        The session determines whether to use a local or remote runner.
        """
        self.session = session
        self.runner = None

    def __enter__(self):
        """
        Determine the appropriate query runner based on the session's remote connection.
        """

        is_remote = self.session.remote_connection
        use_remote_querying = False

        if is_remote:
            use_remote_querying = self.session.remote_connection.useRemoteQuerying

        # Determine if this is a local or remote operation
        if is_remote and use_remote_querying:
            remote_profiler_folder = self.session.remote_profile_folder
            file_path = f"{remote_profiler_folder.remotePath}/{self.DEVICE_LOG_FILE}"
            self.runner = RemoteCSVQueryRunner(
                file_path=file_path,
                remote_connection=self.session.remote_connection,
                offset=1,  # Skip the first line for device log files
            )
        else:
            self.runner = LocalCSVQueryRunner(
                file_path=Path(self.session.profiler_path).joinpath(
                    self.DEVICE_LOG_FILE
                ),
                offset=1,  # Skip the first line for device log files
            )

        self.runner.__enter__()

        if not is_remote or (is_remote and not use_remote_querying):
            self.runner.df.columns = self.DEVICE_LOG_COLUMNS
            self.runner.df.columns = self.runner.df.columns.str.strip()

        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Ensure resources are cleaned up when exiting the context.
        """
        if self.runner:
            self.runner.__exit__(exc_type, exc_val, exc_tb)

    def query_by_timer_id(
        self, timer_id: str, as_dict: bool = False
    ) -> Union[List[List[str]], List[Dict[str, str]]]:
        """
        Example query: Filter rows by a specific timer_id and optionally return results as dictionaries.
        """
        return self.runner.execute_query(
            columns=[],
            filters={"timer_id": timer_id},
            as_dict=as_dict,
        )

    def query_zone_statistics(
        self, zone_name: str, as_dict: bool = False, limit: int = None
    ) -> Union[List[List[str]], List[Dict[str, str]]]:
        """
        Example query: Retrieve statistics for a specific zone name.
        """
        return self.runner.execute_query(
            columns=[],
            filters={"zone name": zone_name},
            as_dict=as_dict,
            limit=limit,
        )

    def get_all_entries(
        self, as_dict: bool = False, limit: int = None
    ) -> List[List[str]]:
        """
        Fetch all entries from the device log.
        """
        return self.runner.execute_query(
            columns=self.DEVICE_LOG_COLUMNS, as_dict=as_dict, limit=limit
        )

    @staticmethod
    def get_raw_csv(session: TabSession):
        from ttnn_visualizer.sftp_operations import read_remote_file

        if (
            not session.remote_connection
            or session.remote_connection
            and not session.remote_connection.useRemoteQuerying
        ):
            file_path = Path(
                session.profiler_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE
            )
            with open(file_path, "r") as f:
                return f.read()
        else:
            profiler_folder = session.remote_profile_folder
            return read_remote_file(
                session.remote_connection,
                f"{profiler_folder.remotePath}/{DeviceLogProfilerQueries.DEVICE_LOG_FILE}",
            )


class OpsPerformanceQueries:
    PERF_RESULTS_PREFIX = "ops_perf_results"
    PERF_RESULTS_COLUMNS = [
        "OP CODE",
        "OP TYPE",
        "GLOBAL CALL COUNT",
        "DEVICE ID",
        "ATTRIBUTES",
        "MATH FIDELITY",
        "CORE COUNT",
        "PARALLELIZATION STRATEGY",
        "HOST START TS",
        "HOST END TS",
        "HOST DURATION [ns]",
        "DEVICE FW START CYCLE",
        "DEVICE FW END CYCLE",
        "OP TO OP LATENCY [ns]",
        "DEVICE FW DURATION [ns]",
        "DEVICE KERNEL DURATION [ns]",
        "DEVICE BRISC KERNEL DURATION [ns]",
        "DEVICE NCRISC KERNEL DURATION [ns]",
        "DEVICE TRISC0 KERNEL DURATION [ns]",
        "DEVICE TRISC1 KERNEL DURATION [ns]",
        "DEVICE TRISC2 KERNEL DURATION [ns]",
        "DEVICE ERISC KERNEL DURATION [ns]",
        "DEVICE COMPUTE CB WAIT FRONT [ns]",
        "DEVICE COMPUTE CB RESERVE BACK [ns]",
        "INPUT_0_W",
        "INPUT_0_Z",
        "INPUT_0_Y",
        "INPUT_0_X",
        "INPUT_0_LAYOUT",
        "INPUT_0_DATATYPE",
        "INPUT_0_MEMORY",
        "INPUT_1_W",
        "INPUT_1_Z",
        "INPUT_1_Y",
        "INPUT_1_X",
        "INPUT_1_LAYOUT",
        "INPUT_1_DATATYPE",
        "INPUT_1_MEMORY",
        "INPUT_2_W",
        "INPUT_2_Z",
        "INPUT_2_Y",
        "INPUT_2_X",
        "INPUT_2_LAYOUT",
        "INPUT_2_DATATYPE",
        "INPUT_2_MEMORY",
        "OUTPUT_0_W",
        "OUTPUT_0_Z",
        "OUTPUT_0_Y",
        "OUTPUT_0_X",
        "OUTPUT_0_LAYOUT",
        "OUTPUT_0_DATATYPE",
        "OUTPUT_0_MEMORY",
        "COMPUTE KERNEL SOURCE",
        "COMPUTE KERNEL HASH",
        "DATA MOVEMENT KERNEL SOURCE",
        "DATA MOVEMENT KERNEL HASH",
        "PM IDEAL [ns]",
        "PM COMPUTE [ns]",
        "PM BANDWIDTH [ns]",
        "PM REQ I BW",
        "PM REQ O BW",
        "CompileProgram_TT_HOST_FUNC [ns]",
        "HWCommandQueue_write_buffer_TT_HOST_FUNC [ns]",
    ]

    def __init__(self, session: TabSession):
        """
        Initialize the performance profiler with a session object.
        """
        self.session = session
        self.runner = None

    def __enter__(self):
        """

        :return:
        """
        file_path = OpsPerformanceQueries.get_local_ops_perf_file_path(self.session)
        self.runner = LocalCSVQueryRunner(file_path=file_path, offset=1)
        self.runner.__enter__()

        # Set up columns
        self.runner.df.columns = self.PERF_RESULTS_COLUMNS
        self.runner.df.columns = self.runner.df.columns.str.strip()

        return self

    @staticmethod
    def get_local_ops_perf_file_path(session):
        profiler_path = Path(session.profiler_path)

        # Find the latest file with the correct prefix
        perf_files = list(
            profiler_path.glob(f"{OpsPerformanceQueries.PERF_RESULTS_PREFIX}_*.csv")
        )
        if not perf_files:
            raise FileNotFoundError("No performance results file found.")

        # Use the latest file
        latest_file = max(perf_files, key=os.path.getctime)
        return str(latest_file)

    @staticmethod
    def get_remote_ops_perf_file_path(session):
        from ttnn_visualizer.sftp_operations import resolve_file_path

        remote_profile_folder = session.remote_profile_folder.remotePath
        return resolve_file_path(
            session.remote_connection,
            f"{remote_profile_folder}/{OpsPerformanceQueries.PERF_RESULTS_PREFIX}*",
        )

    @staticmethod
    def get_raw_csv(session):
        from ttnn_visualizer.sftp_operations import read_remote_file

        if (
            not session.remote_connection
            or session.remote_connection
            and not session.remote_connection.useRemoteQuerying
        ):
            with open(OpsPerformanceQueries.get_local_ops_perf_file_path(session)) as f:
                return f.read()
        else:
            path = OpsPerformanceQueries.get_remote_ops_perf_file_path(session)
            return read_remote_file(session.remote_connection, path)

    def __exit__(self, exc_type, exc_val, exc_tb):
        """
        Clean up resources when exiting the context.
        """
        if self.runner:
            self.runner.__exit__(exc_type, exc_val, exc_tb)

    def query_by_op_code(
        self, op_code: str, as_dict: bool = False
    ) -> Union[List[List[str]], List[Dict[str, str]]]:
        """
        Query for rows with a specific OP CODE.
        """
        return self.runner.execute_query(
            filters={"OP CODE": op_code}, as_dict=as_dict, columns=None
        )

    def get_all_entries(
        self, as_dict: bool = False, limit: int = None
    ) -> List[List[str]]:
        """
        Fetch all entries from the performance log.
        """
        return self.runner.execute_query(
            columns=self.PERF_RESULTS_COLUMNS, as_dict=as_dict, limit=limit
        )


class OpsPerformanceReportQueries:
    REPORT_COLUMNS = [
        "id",
        "total_percent",
        "bound",
        "op_code",
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
        "advice",
        "raw_op_code"
    ]

    DEFAULT_SIGNPOST = None
    DEFAULT_IGNORE_SIGNPOSTS = None
    DEFAULT_MIN_PERCENTAGE = 0.5
    DEFAULT_ID_RANGE = None
    DEFAULT_NO_ADVICE = False
    DEFAULT_TRACING_MODE = False

    @classmethod
    def generate_report(cls, session):
        raw_csv = OpsPerformanceQueries.get_raw_csv(session)
        csv_file = StringIO(raw_csv)
        csv_output_file = tempfile.mktemp(suffix=".csv")
        perf_report.generate_perf_report(
            csv_file,
            cls.DEFAULT_SIGNPOST,
            cls.DEFAULT_IGNORE_SIGNPOSTS,
            cls.DEFAULT_MIN_PERCENTAGE,
            cls.DEFAULT_ID_RANGE,
            csv_output_file,
            cls.DEFAULT_NO_ADVICE,
            cls.DEFAULT_TRACING_MODE,
            True,
            True,
        )

        report = []

        try:
            with open(csv_output_file, newline="") as csvfile:
                reader = csv.reader(csvfile, delimiter=",")
                next(reader, None)
                for row in reader:
                    processed_row = {
                        column: row[index] for index, column in enumerate(cls.REPORT_COLUMNS) if index < len(row)
                    }
                    if "advice" in processed_row and processed_row["advice"]:
                        processed_row["advice"] = processed_row["advice"].split(" • ")
                    else:
                        processed_row["advice"] = []
                    report.append(processed_row)
        except csv.Error as e:
            raise DataFormatError() from e
        finally:
            os.unlink(csv_output_file)

        return report
