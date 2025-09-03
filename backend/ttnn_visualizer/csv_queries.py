# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import csv
import json
import os
import tempfile
from io import StringIO
from pathlib import Path
from typing import Dict, List, Optional, Union

import pandas as pd
import zstd
from tt_perf_report import perf_report
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.models import Instance


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


class NPEQueries:
    NPE_FOLDER = "npe_viz"
    MANIFEST_FILE = "manifest.json"

    @staticmethod
    def get_npe_manifest(instance: Instance):

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
            raise ValueError(
                "filename parameter is required and cannot be None or empty"
            )

        if not instance.performance_path:
            raise ValueError("instance.performance_path is None")

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

    def __init__(self, instance: Instance):
        """
        Initialize the profiler with a instance object.
        The instance determines whether to use a local or remote runner.
        """
        self.instance = instance
        self.runner = None

    def __enter__(self):
        """
        Determine the appropriate query runner based on the instance's remote connection.
        """
        self.runner = LocalCSVQueryRunner(
            file_path=Path(self.instance.performance_path).joinpath(
                self.DEVICE_LOG_FILE
            ),
            offset=1,  # Skip the first line for device log files
        )

        self.runner.__enter__()

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
    def get_raw_csv(instance: Instance):
        file_path = Path(
            instance.performance_path, DeviceLogProfilerQueries.DEVICE_LOG_FILE
        )
        with open(file_path, "r") as f:
            return f.read()


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

    def __init__(self, instance: Instance):
        """
        Initialize the performance profiler with a instance object.
        """
        self.instance = instance
        self.runner = None

    def __enter__(self):
        """

        :return:
        """
        file_path = OpsPerformanceQueries.get_local_ops_perf_file_path(self.instance)
        self.runner = LocalCSVQueryRunner(file_path=file_path, offset=1)
        self.runner.__enter__()

        # Set up columns
        self.runner.df.columns = self.PERF_RESULTS_COLUMNS
        self.runner.df.columns = self.runner.df.columns.str.strip()

        return self

    @staticmethod
    def get_local_ops_perf_file_path(instance):
        performance_path = Path(instance.performance_path)

        # Find the latest file with the correct prefix
        perf_files = list(
            performance_path.glob(f"{OpsPerformanceQueries.PERF_RESULTS_PREFIX}.csv")
        ) + list(
            performance_path.glob(f"{OpsPerformanceQueries.PERF_RESULTS_PREFIX}_*.csv")
        )
        if not perf_files:
            raise FileNotFoundError("No performance results file found.")

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

    PASSTHROUGH_COLUMNS = {
        "pm_ideal_ns": "PM IDEAL [ns]",
    }

    DEFAULT_SIGNPOST = None
    DEFAULT_IGNORE_SIGNPOSTS = None
    DEFAULT_MIN_PERCENTAGE = 0.5
    DEFAULT_ID_RANGE = None
    DEFAULT_NO_ADVICE = False
    DEFAULT_TRACING_MODE = False

    @classmethod
    def generate_report(cls, instance):
        raw_csv = OpsPerformanceQueries.get_raw_csv(instance)
        csv_file = StringIO(raw_csv)
        csv_output_file = tempfile.mktemp(suffix=".csv")

        try:
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
                True,
                True,
                False,
            )
        except Exception as e:
            raise DataFormatError(f"Error generating performance report: {e}") from e

        ops_perf_results = []
        ops_perf_results_reader = csv.DictReader(StringIO(raw_csv))

        for row in ops_perf_results_reader:
            ops_perf_results.append(row)

        report = []

        try:
            with open(csv_output_file, newline="") as csvfile:
                reader = csv.reader(csvfile, delimiter=",")
                next(reader, None)
                for row in reader:
                    processed_row = {
                        column: row[index]
                        for index, column in enumerate(cls.REPORT_COLUMNS)
                        if index < len(row)
                    }
                    if "advice" in processed_row and processed_row["advice"]:
                        processed_row["advice"] = processed_row["advice"].split(" • ")
                    else:
                        processed_row["advice"] = []

                    for key, value in cls.PASSTHROUGH_COLUMNS.items():
                        op_id = int(row[0])
                        idx = (
                            op_id - 2
                        )  # IDs in result column one correspond to row numbers in ops perf results csv
                        processed_row[key] = ops_perf_results[idx][value]

                    report.append(processed_row)
        except csv.Error as e:
            raise DataFormatError() from e
        finally:
            os.unlink(csv_output_file)

        return report
