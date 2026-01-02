# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
import json
import logging
import re
import shutil
import time
from http import HTTPStatus
from pathlib import Path
from typing import List

import orjson
import yaml
import zstd
from flask import Blueprint, Response, current_app, jsonify, request, session
from ttnn_visualizer.csv_queries import (
    DeviceLogProfilerQueries,
    NPEQueries,
    OpsPerformanceQueries,
    OpsPerformanceReportQueries,
)
from ttnn_visualizer.decorators import local_only, with_instance
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import (
    AuthenticationFailedException,
    DataFormatError,
    RemoteConnectionException,
)
from ttnn_visualizer.file_uploads import (
    extract_folder_name_from_files,
    extract_npe_name,
    save_uploaded_files,
    validate_files,
)
from ttnn_visualizer.instances import get_instances, update_instance
from ttnn_visualizer.models import (
    Instance,
    RemoteConnection,
    RemoteReportFolder,
    StatusMessage,
)
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.serializers import (
    serialize_buffer,
    serialize_buffer_pages,
    serialize_devices,
    serialize_operation,
    serialize_operation_buffers,
    serialize_operations,
    serialize_operations_buffers,
    serialize_tensors,
)
from ttnn_visualizer.sftp_operations import (
    check_remote_path_exists,
    check_remote_path_for_reports,
    get_cluster_desc,
    get_remote_performance_folders,
    get_remote_profiler_folders,
    read_remote_file,
    sync_remote_performance_folders,
    sync_remote_profiler_folders,
)
from ttnn_visualizer.ssh_client import SSHClient
from ttnn_visualizer.utils import (
    create_path_resolver,
    get_cluster_descriptor_path,
    read_last_synced_file,
    str_to_bool,
    timer,
)


def test_ssh_connection(connection) -> bool:
    """Test SSH connection by running a simple command."""
    ssh_client = SSHClient(connection)
    return ssh_client.test_connection()


logger = logging.getLogger(__name__)

api = Blueprint("api", __name__)


@api.route("/operations", methods=["GET"])
@with_instance
@timer
def operation_list(instance: Instance):
    with DatabaseQueries(instance) as db:
        operations = list(db.query_operations())
        operations.sort(key=lambda o: o.operation_id)
        operation_arguments = list(db.query_operation_arguments())
        device_operations = list(db.query_device_operations())
        stack_traces = list(db.query_stack_traces())
        outputs = list(db.query_output_tensors())
        tensors = list(db.query_tensors())
        inputs = list(db.query_input_tensors())
        devices = list(db.query_devices())
        producers_consumers = list(db.query_producers_consumers())

        error_records = None
        if db._check_table_exists("errors"):
            error_records = list(db.query_error_records())

        serialized_operations = serialize_operations(
            inputs,
            operation_arguments,
            operations,
            outputs,
            stack_traces,
            tensors,
            devices,
            producers_consumers,
            device_operations,
            error_records,
        )
        return Response(
            orjson.dumps(serialized_operations),
            mimetype="application/json",
        )


@api.route("/operations/<operation_id>", methods=["GET"])
@with_instance
@timer
def operation_detail(operation_id, instance: Instance):
    with DatabaseQueries(instance) as db:

        device_id = request.args.get("device_id", None)
        operations = list(db.query_operations(filters={"operation_id": operation_id}))

        if not operations:
            return Response(status=HTTPStatus.NOT_FOUND)

        operation = operations[0]

        buffers = list(
            db.query_buffers(
                filters={"operation_id": operation_id, "device_id": device_id}
            )
        )
        operation_arguments = list(
            db.query_operation_arguments(filters={"operation_id": operation_id})
        )
        stack_trace = list(
            db.query_stack_traces(filters={"operation_id": operation_id})
        )

        if stack_trace:
            stack_trace = stack_trace[0]
        else:
            stack_trace = None

        inputs = list(db.query_input_tensors(filters={"operation_id": operation_id}))
        outputs = list(db.query_output_tensors({"operation_id": operation_id}))

        input_tensor_ids = [i.tensor_id for i in inputs]
        output_tensor_ids = [o.tensor_id for o in outputs]
        tensor_ids = input_tensor_ids + output_tensor_ids
        tensors = list(db.query_tensors(filters={"tensor_id": tensor_ids}))
        local_comparisons = list(
            db.query_tensor_comparisons(filters={"tensor_id": tensor_ids})
        )
        global_comparisons = list(
            db.query_tensor_comparisons(local=False, filters={"tensor_id": tensor_ids})
        )

        device_operations = db.query_device_operations(
            filters={"operation_id": operation_id}
        )

        producers_consumers = list(
            filter(
                lambda pc: pc.tensor_id in tensor_ids, db.query_producers_consumers()
            )
        )

        devices = list(db.query_devices())

        error_record = None
        if db._check_table_exists("errors"):
            error_records = list(
                db.query_error_records(filters={"operation_id": operation_id})
            )
            if error_records:
                error_record = error_records[0]

        serialized_operation = serialize_operation(
            buffers,
            inputs,
            operation,
            operation_arguments,
            outputs,
            stack_trace,
            tensors,
            global_comparisons,
            local_comparisons,
            devices,
            producers_consumers,
            device_operations,
            error_record,
        )

        return Response(
            orjson.dumps(serialized_operation),
            mimetype="application/json",
        )


@api.route("/operation-history", methods=["GET"])
@with_instance
@timer
def operation_history(instance: Instance):
    operation_history_filename = "operation_history.json"
    operation_history_file = (
        Path(str(instance.profiler_path)).parent / operation_history_filename
    )
    if not operation_history_file.exists():
        return jsonify([])
    with open(operation_history_file, "r") as file:
        return Response(
            orjson.dumps(json.load(file)),
            mimetype="application/json",
        )


@api.route("/errors", methods=["GET"])
@with_instance
@timer
def errors_list(instance: Instance):
    with DatabaseQueries(instance) as db:
        if not db._check_table_exists("errors"):
            return (
                jsonify(
                    {
                        "error": "Error records table does not exist in this report database."
                    }
                ),
                HTTPStatus.UNPROCESSABLE_ENTITY,
            )

        error_records = list(db.query_error_records())
        serialized_errors = [dataclasses.asdict(error) for error in error_records]

        return Response(
            orjson.dumps(serialized_errors),
            mimetype="application/json",
        )


@api.route("/config")
@with_instance
@timer
def get_config(instance: Instance):
    config_file = Path(str(instance.profiler_path)).parent.joinpath("config.json")
    if not config_file.exists():
        return {}
    with open(config_file, "r") as file:
        return Response(
            orjson.dumps(json.load(file)),
            mimetype="application/json",
        )


@api.route("/tensors", methods=["GET"])
@with_instance
@timer
def tensors_list(instance: Instance):
    with DatabaseQueries(instance) as db:
        device_id = request.args.get("device_id", None)
        tensors = list(db.query_tensors(filters={"device_id": device_id}))
        local_comparisons = list(db.query_tensor_comparisons())
        global_comparisons = list(db.query_tensor_comparisons(local=False))
        producers_consumers = list(db.query_producers_consumers())
        serialized_tensors = serialize_tensors(
            tensors, producers_consumers, local_comparisons, global_comparisons
        )
        return Response(
            orjson.dumps(serialized_tensors),
            mimetype="application/json",
        )


@api.route("/buffer", methods=["GET"])
@with_instance
@timer
def buffer_detail(instance: Instance):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")

    if not address or not operation_id:
        return Response(status=HTTPStatus.BAD_REQUEST)

    if operation_id and str.isdigit(operation_id):
        operation_id = int(operation_id)
    else:
        return Response(status=HTTPStatus.BAD_REQUEST)

    with DatabaseQueries(instance) as db:
        buffer = db.query_next_buffer(operation_id, address)
        if not buffer:
            return Response(status=HTTPStatus.NOT_FOUND)
        return Response(
            orjson.dumps(dataclasses.asdict(buffer)),
            mimetype="application/json",
        )


@api.route("/buffer-pages", methods=["GET"])
@with_instance
@timer
def buffer_pages(instance: Instance):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)

    if address:
        addresses = [addr.strip() for addr in address.split(",")]
    else:
        addresses = None

    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(instance) as db:
        buffers = list(
            list(
                db.query_buffer_pages(
                    filters={
                        "operation_id": operation_id,
                        "device_id": device_id,
                        "address": addresses,
                        "buffer_type": buffer_type,
                    }
                )
            )
        )
        return Response(
            orjson.dumps(serialize_buffer_pages(buffers)),
            mimetype="application/json",
        )


@api.route("/tensors/<tensor_id>", methods=["GET"])
@with_instance
@timer
def tensor_detail(tensor_id, instance: Instance):
    with DatabaseQueries(instance) as db:
        tensors = list(db.query_tensors(filters={"tensor_id": tensor_id}))
        if not tensors:
            return Response(status=HTTPStatus.NOT_FOUND)

        return Response(
            orjson.dumps(dataclasses.asdict(tensors[0])),
            mimetype="application/json",
        )


@api.route("/buffers", methods=["GET"])
@with_instance
def get_all_buffers(instance: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(instance) as db:
        buffers = list(
            db.query_buffers(
                filters={"buffer_type": buffer_type, "device_id": device_id}
            )
        )
        serialized = [serialize_buffer(b) for b in buffers]
        return Response(orjson.dumps(serialized), mimetype="application/json")


@api.route("/operation-buffers", methods=["GET"])
@with_instance
def get_operations_buffers(instance: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)

    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(instance) as db:
        buffers = list(
            db.query_buffers(
                filters={"buffer_type": buffer_type, "device_id": device_id}
            )
        )
        operations = list(db.query_operations())
        return Response(
            orjson.dumps(serialize_operations_buffers(operations, buffers)),
            mimetype="application/json",
        )


@api.route("/operation-buffers/<operation_id>", methods=["GET"])
@with_instance
def get_operation_buffers(operation_id, instance: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(instance) as db:
        operations = list(db.query_operations(filters={"operation_id": operation_id}))
        if not operations:
            return Response(status=HTTPStatus.NOT_FOUND)
        operation = operations[0]
        buffers = list(
            db.query_buffers(
                filters={
                    "operation_id": operation_id,
                    "buffer_type": buffer_type,
                    "device_id": device_id,
                }
            )
        )
        if not operation:
            return Response(status=HTTPStatus.NOT_FOUND)

        return Response(
            orjson.dumps(serialize_operation_buffers(operation, buffers)),
            mimetype="application/json",
        )


@api.route("/profiler", methods=["GET"])
@with_instance
def get_profiler_data_list(instance: Instance):
    # Use PathResolver to get the base path for profiler reports
    resolver = create_path_resolver(current_app)

    # Note: "profiler" in app terminology maps to tt-metal's ttnn/reports
    path = resolver.get_base_report_path("profiler")

    if not path.exists():
        if resolver.is_direct_report_mode:
            logger.warning(f"TT-Metal profiler reports not found: {path}")
            return []
        else:
            path.mkdir(parents=True, exist_ok=True)

    valid_dirs = []

    if current_app.config["SERVER_MODE"]:
        session_instances = session.get("instances", [])
        instances = get_instances(session_instances)
        db_paths = [
            instance.profiler_path for instance in instances if instance.profiler_path
        ]
        db_directory_names = [str(Path(db_path).parent.name) for db_path in db_paths]
        session_paths = session.get("profiler_paths", [])
        session_directory_names = [
            str(Path(session_path).parent.name) for session_path in session_paths
        ]
        demo_directory_names = []
        demo_pattern = re.compile(r"^demo", re.IGNORECASE)
        for report in path.glob("*"):
            if demo_pattern.match(report.name):
                demo_directory_names.append(report.name)
        directory_names = list(
            set(db_directory_names + session_directory_names + demo_directory_names)
        )
    else:
        directory_names = [
            directory.name for directory in path.iterdir() if directory.is_dir()
        ]

    # Sort directory names by modified time (most recent first)
    def get_modified_time(dir_name):
        dir_path = Path(path) / dir_name
        if dir_path.exists():
            return dir_path.stat().st_mtime
        return 0

    directory_names.sort(key=get_modified_time, reverse=True)

    for dir_name in directory_names:
        dir_path = Path(path) / dir_name
        files = list(dir_path.glob("**/*"))
        report_name = None
        config_file = dir_path / "config.json"

        if config_file.exists():
            try:
                with open(config_file, "r") as f:
                    config_data = json.load(f)
                    report_name = config_data.get("report_name")
            except Exception as e:
                logger.warning(f"Failed to read config.json in {dir_path}: {e}")

        # Would like to use the existing validate_files function but there's a type difference I'm not sure how to handle
        if not any(file.name == "db.sqlite" for file in files):
            continue
        if not any(file.name == "config.json" for file in files):
            continue
        valid_dirs.append({"path": dir_path.name, "reportName": report_name})

    return Response(orjson.dumps(valid_dirs), mimetype="application/json")


@api.route("/profiler/<profiler_name>", methods=["DELETE"])
@with_instance
@local_only
def delete_profiler_report(profiler_name, instance: Instance):
    is_remote = bool(instance.remote_connection)
    config_key = "REMOTE_DATA_DIRECTORY" if is_remote else "LOCAL_DATA_DIRECTORY"
    data_directory = Path(current_app.config[config_key])

    if not profiler_name:
        return Response(
            status=HTTPStatus.BAD_REQUEST, response="Report name is required."
        )

    if is_remote:
        connection = RemoteConnection.model_validate(
            instance.remote_connection, strict=False
        )
        path = (
            data_directory
            / connection.host
            / current_app.config["PROFILER_DIRECTORY_NAME"]
        )
    else:
        path = (
            data_directory
            / current_app.config["PROFILER_DIRECTORY_NAME"]
            / profiler_name
        )

    if instance.active_report and instance.active_report.profiler_name == profiler_name:
        instance_id = request.args.get("instanceId")
        update_instance(instance_id=instance_id, profiler_name="")

    if path.exists() and path.is_dir():
        shutil.rmtree(path)
    else:
        return Response(
            status=HTTPStatus.NOT_FOUND, response=f"Report does not exist: {path}"
        )

    return Response(
        status=HTTPStatus.NO_CONTENT, response=f"Report deleted successfully: {path}"
    )


@api.route("/performance", methods=["GET"])
@with_instance
def get_performance_data_list(instance: Instance):
    # Use PathResolver to get the base path for performance reports
    resolver = create_path_resolver(current_app)

    # Note: "performance" in app terminology maps to tt-metal's profiler/reports
    path = resolver.get_base_report_path("performance")

    if not path.exists():
        if resolver.is_direct_report_mode:
            logger.warning(f"TT-Metal performance reports not found: {path}")
            return jsonify([])

    if current_app.config["SERVER_MODE"]:
        session_instances = session.get("instances", [])
        instances = get_instances(session_instances)
        db_paths = [
            instance.performance_path
            for instance in instances
            if instance.performance_path
        ]
        db_directory_names = [str(Path(db_path).name) for db_path in db_paths]
        session_paths = session.get("performance_paths", [])
        session_directory_names = [
            str(Path(session_path).name) for session_path in session_paths
        ]
        demo_directory_names = []
        demo_pattern = re.compile(r"^demo", re.IGNORECASE)
        for report in path.glob("*"):
            if demo_pattern.match(report.name):
                demo_directory_names.append(report.name)
        directory_names = list(
            set(db_directory_names + session_directory_names + demo_directory_names)
        )
    else:
        # PathResolver already handles remote vs local logic
        directory_names = (
            [directory.name for directory in path.iterdir() if directory.is_dir()]
            if path.exists()
            else []
        )

    valid_dirs = []

    # Sort directory names by modified time (most recent first)
    def get_modified_time(dir_name):
        dir_path = Path(path) / dir_name
        if dir_path.exists():
            return dir_path.stat().st_mtime
        return 0

    directory_names.sort(key=get_modified_time, reverse=True)

    for dir_name in directory_names:
        dir_path = Path(path) / dir_name
        files = list(dir_path.glob("**/*"))

        # Would like to use the existing validate_files function but there's a type difference I'm not sure how to handle
        if not any(file.name == "profile_log_device.csv" for file in files):
            continue
        if not any(file.name == "tracy_profile_log_host.tracy" for file in files):
            continue
        if not any(file.name.startswith("ops_perf_results") for file in files):
            continue

        valid_dirs.append(
            {
                "path": dir_path.name,
                "reportName": dir_path.name,
            }
        )

    return Response(orjson.dumps(valid_dirs), mimetype="application/json")


@api.route("/performance/device-log", methods=["GET"])
@with_instance
def get_performance_data(instance: Instance):
    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)

    with DeviceLogProfilerQueries(instance) as csv:
        result = csv.get_all_entries(as_dict=True, limit=100)
        return Response(orjson.dumps(result), mimetype="application/json")


@api.route("/performance/perf-results", methods=["GET"])
@with_instance
def get_profiler_performance_data(instance: Instance):
    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    with OpsPerformanceQueries(instance) as csv:
        # result = csv.query_by_op_code(op_code="(torch) contiguous", as_dict=True)
        result = csv.get_all_entries(as_dict=True, limit=100)
        return Response(orjson.dumps(result), mimetype="application/json")


@api.route("/performance/<performance_name>", methods=["DELETE"])
@with_instance
@local_only
def delete_performance_report(performance_name, instance: Instance):
    is_remote = bool(instance.remote_connection)
    config_key = "REMOTE_DATA_DIRECTORY" if is_remote else "LOCAL_DATA_DIRECTORY"
    data_directory = Path(current_app.config[config_key])

    if not performance_name:
        return Response(
            status=HTTPStatus.BAD_REQUEST, response="Report name is required."
        )

    if is_remote:
        connection = RemoteConnection.model_validate(
            instance.remote_connection, strict=False
        )
        path = (
            data_directory
            / connection.host
            / current_app.config["PERFORMANCE_DIRECTORY_NAME"]
        )
    else:
        path = (
            data_directory
            / current_app.config["PERFORMANCE_DIRECTORY_NAME"]
            / performance_name
        )

    if (
        instance.active_report
        and instance.active_report.performance_name == performance_name
    ):
        instance_id = request.args.get("instanceId")
        update_instance(instance_id=instance_id, performance_name="")

    if path.exists() and path.is_dir():
        shutil.rmtree(path)
    else:
        return Response(
            status=HTTPStatus.NOT_FOUND, response=f"Report does not exist: {path}"
        )

    return Response(
        status=HTTPStatus.NO_CONTENT, response=f"Report deleted successfully: {path}"
    )


@api.route("/performance/perf-results/raw", methods=["GET"])
@with_instance
def get_performance_results_data_raw(instance: Instance):
    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    content = OpsPerformanceQueries.get_raw_csv(instance)
    return Response(
        content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=op_perf_results.csv"},
    )


@api.route("/performance/perf-results/report", methods=["GET"])
@with_instance
def get_performance_results_report(instance: Instance):
    if not instance.performance_path:
        return Response(
            status=HTTPStatus.BAD_REQUEST,
            response="No performance data found for instance.",
        )

    name = request.args.get("name", None)
    start_signpost = request.args.get("start_signpost", None)
    end_signpost = request.args.get("end_signpost", None)
    print_signposts = str_to_bool(request.args.get("print_signposts", "true"))
    stack_by_in0 = str_to_bool(request.args.get("stack_by_in0", "true"))
    hide_host_ops = str_to_bool(request.args.get("hide_host_ops", "true"))
    merge_devices = str_to_bool(request.args.get("merge_devices", "true"))

    if name and not current_app.config["SERVER_MODE"]:
        performance_path = Path(instance.performance_path).parent / name
        instance.performance_path = str(performance_path)
        logger.info(f"************ Performance path set to {instance.performance_path}")

    try:
        report = OpsPerformanceReportQueries.generate_report(
            instance,
            stack_by_in0=stack_by_in0,
            start_signpost=start_signpost,
            print_signposts=print_signposts,
            end_signpost=end_signpost,
            hide_host_ops=hide_host_ops,
            merge_devices=merge_devices,
        )
    except DataFormatError:
        return Response(status=HTTPStatus.UNPROCESSABLE_ENTITY)

    return Response(orjson.dumps(report), mimetype="application/json")


# this is no longer used atm. keeping for now until confirmed "not needed"
@api.route("/performance/device-log/raw", methods=["GET"])
@with_instance
def get_performance_data_raw(instance: Instance):
    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)

    name = request.args.get("name", None)

    if name and not current_app.config["SERVER_MODE"]:
        performance_path = Path(instance.performance_path).parent / name
        instance.performance_path = str(performance_path)
        logger.info(f"************ Performance path set to {instance.performance_path}")

    content = DeviceLogProfilerQueries.get_raw_csv(instance)

    return Response(
        content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=profile_log_device.csv"},
    )


@api.route("/performance/device-log/meta", methods=["GET"])
@with_instance
def get_performance_device_meta(instance: Instance):
    def get_first_line(file_path: Path) -> str:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.readline().strip()

    def parse_arch_and_freq(line: str):
        arch_match = re.search(r"ARCH:\s*([\w\d_]+)", line)
        freq_match = re.search(r"CHIP_FREQ\[MHz\]:\s*(\d+)", line)
        cores_match = re.search(r"Max Compute Cores:\s*(\d+)", line)

        architecture = arch_match.group(1) if arch_match else None
        frequency = int(freq_match.group(1)) if freq_match else None
        max_cores = int(cores_match.group(1)) if cores_match else None

        return {
            "architecture": architecture,
            "frequency": frequency,
            "max_cores": max_cores,
        }

    name = request.args.get("name", None)

    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)

    if name and not current_app.config["SERVER_MODE"]:
        performance_path = Path(instance.performance_path).parent / name
        instance.performance_path = str(performance_path)
        logger.info(f"************ Performance path set to {instance.performance_path}")

    file_path = Path(
        instance.performance_path,
        DeviceLogProfilerQueries.DEVICE_LOG_FILE,
    )

    if not file_path.exists():
        return Response(status=HTTPStatus.NOT_FOUND)

    try:
        first_line = get_first_line(file_path)
        meta = parse_arch_and_freq(first_line)
        return jsonify(meta)

    except Exception as e:
        logger.exception("Failed to parse device meta")
        return Response(str(e), status=HTTPStatus.INTERNAL_SERVER_ERROR)


@api.route("/performance/npe/manifest", methods=["GET"])
@with_instance
def get_npe_manifest(instance: Instance):
    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    try:
        content = NPEQueries.get_npe_manifest(instance)
    except FileNotFoundError:
        return jsonify([])

    return Response(orjson.dumps(content), mimetype="application/json")


@api.route("/performance/npe/timeline", methods=["GET"])
@with_instance
def get_npe_timeline(instance: Instance):
    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)

    filename = request.args.get("filename", default=None)

    if not filename:
        return Response(orjson.dumps({}), mimetype="application/json")

    filename = Path(filename).name

    try:
        content = NPEQueries.get_npe_timeline(instance, filename=filename)
    except FileNotFoundError:
        return Response(orjson.dumps({}), mimetype="application/json")

    return Response(orjson.dumps(content), mimetype="application/json")


@api.route("/performance/device-log/zone/<zone>", methods=["GET"])
@with_instance
def get_zone_statistics(zone, instance: Instance):
    if not instance.performance_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    with DeviceLogProfilerQueries(instance) as csv:
        result = csv.query_zone_statistics(zone_name=zone, as_dict=True)
        return Response(orjson.dumps(result), mimetype="application/json")


@api.route("/devices", methods=["GET"])
@with_instance
def get_devices(instance: Instance):
    with DatabaseQueries(instance) as db:
        devices = list(db.query_devices())
        return Response(
            orjson.dumps(serialize_devices(devices)),
            mimetype="application/json",
        )


@api.route("/local/upload/profiler", methods=["POST"])
def create_profiler_files():
    files = request.files.getlist("files")
    folder_name = request.form.get(
        "folderName"
    )  # Optional folder name - Used for Safari compatibility
    profiler_directory = (
        current_app.config["LOCAL_DATA_DIRECTORY"]
        / current_app.config["PROFILER_DIRECTORY_NAME"]
    )

    if not validate_files(files, {"db.sqlite", "config.json"}, folder_name=folder_name):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Invalid project directory.",
        ).model_dump()

    if not profiler_directory.exists():
        profiler_directory.mkdir(parents=True, exist_ok=True)

    if folder_name:
        parent_folder_name = folder_name
    else:
        parent_folder_name = extract_folder_name_from_files(files)

    logger.info(f"Writing report files to {profiler_directory}/{parent_folder_name}")

    try:
        paths = save_uploaded_files(files, profiler_directory, folder_name)
    except DataFormatError:
        return Response(status=HTTPStatus.UNPROCESSABLE_ENTITY)

    profiler_path = next((p for p in paths if Path(p).name == "db.sqlite"), None)

    instance_id = request.args.get("instanceId")

    update_instance(
        instance_id=instance_id,
        profiler_name=parent_folder_name,
        clear_remote=True,
        profiler_path=str(profiler_path) if profiler_path else None,
    )

    config_file = profiler_directory / parent_folder_name / "config.json"
    report_name = None

    if config_file.exists():
        try:
            with open(config_file, "r") as f:
                config_data = json.load(f)
                report_name = config_data.get("report_name")
        except Exception as e:
            logger.warning(f"Failed to read config.json in {config_file}: {e}")

    # Set session data
    session["profiler_paths"] = session.get("profiler_paths", []) + [str(profiler_path)]
    session.permanent = True

    return {
        "path": parent_folder_name,
        "reportName": report_name,
    }


@api.route("/local/upload/performance", methods=["POST"])
def create_performance_files():
    files = request.files.getlist("files")
    folder_name = request.form.get("folderName")  # Optional folder name
    data_directory = Path(current_app.config["LOCAL_DATA_DIRECTORY"])

    if not validate_files(
        files,
        {"profile_log_device.csv", "tracy_profile_log_host.tracy"},
        pattern="ops_perf_results",
        folder_name=folder_name,
    ):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Invalid project directory.",
        ).model_dump()

    target_directory = data_directory / current_app.config["PERFORMANCE_DIRECTORY_NAME"]

    if not target_directory.exists():
        target_directory.mkdir(parents=True, exist_ok=True)

    if folder_name:
        parent_folder_name = folder_name
    else:
        parent_folder_name = extract_folder_name_from_files(files)

    logger.info(f"Saving performance report files {parent_folder_name}")

    try:
        paths = save_uploaded_files(
            files,
            target_directory,
            folder_name,
        )
    except DataFormatError:
        return Response(status=HTTPStatus.UNPROCESSABLE_ENTITY)

    performance_path = str(paths[0].parent)

    instance_id = request.args.get("instanceId")
    update_instance(
        instance_id=instance_id,
        performance_name=parent_folder_name,
        clear_remote=True,
        performance_path=performance_path,
    )

    session["performance_paths"] = session.get("performance_paths", []) + [
        str(performance_path)
    ]
    session.permanent = True

    return StatusMessage(
        status=ConnectionTestStates.OK, message="Success."
    ).model_dump()


@api.route("/local/upload/npe", methods=["POST"])
def create_npe_files():
    files = request.files.getlist("files")
    data_directory = current_app.config["LOCAL_DATA_DIRECTORY"]

    for file in files:
        if (
            not file.filename.endswith(".json")
            and not file.filename.endswith(".zst")
            and not file.filename.endswith(".npeviz")
        ):
            return StatusMessage(
                status=ConnectionTestStates.FAILED,
                message="NPE requires a valid .json or .zst file",
            ).model_dump()

    npe_name = extract_npe_name(files)
    target_directory = data_directory / current_app.config["NPE_DIRECTORY_NAME"]
    target_directory.mkdir(parents=True, exist_ok=True)

    try:
        paths = save_uploaded_files(files, target_directory)
    except DataFormatError:
        return Response(status=HTTPStatus.UNPROCESSABLE_ENTITY)

    instance_id = request.args.get("instanceId")
    npe_path = str(paths[0])
    update_instance(
        instance_id=instance_id, npe_name=npe_name, clear_remote=True, npe_path=npe_path
    )

    session["npe_paths"] = session.get("npe_paths", []) + [str(npe_path)]
    session.permanent = True

    return StatusMessage(status=ConnectionTestStates.OK, message="Success").model_dump()


@api.route("/remote/profiler", methods=["POST"])
def get_remote_folders_profiler():
    connection = RemoteConnection.model_validate(request.json, strict=False)
    try:
        remote_folders: List[RemoteReportFolder] = get_remote_profiler_folders(
            RemoteConnection.model_validate(connection, strict=False)
        )

        for rf in remote_folders:
            directory_name = Path(rf.remotePath).name
            remote_data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
            local_path = (
                remote_data_directory
                / current_app.config["PROFILER_DIRECTORY_NAME"]
                / connection.host
                / directory_name
            )
            logger.info(f"Checking last synced for {directory_name}")
            rf.lastSynced = read_last_synced_file(str(local_path))
            if not rf.lastSynced:
                logger.info(f"{directory_name} not yet synced")

        return Response(
            orjson.dumps([r.model_dump() for r in remote_folders]),
            mimetype="application/json",
        )
    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)


@api.route("/remote/performance", methods=["POST"])
def get_remote_folders_performance():
    request_body = request.get_json()
    connection = RemoteConnection.model_validate(
        request_body.get("connection"), strict=False
    )

    try:
        remote_performance_folders: List[RemoteReportFolder] = (
            get_remote_performance_folders(
                RemoteConnection.model_validate(connection, strict=False)
            )
        )

        for rf in remote_performance_folders:
            performance_name = Path(rf.remotePath).name
            remote_data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
            local_path = (
                remote_data_directory
                / current_app.config["PERFORMANCE_DIRECTORY_NAME"]
                / connection.host
                / performance_name
            )
            logger.info(f"Checking last synced for {performance_name}")
            rf.lastSynced = read_last_synced_file(str(local_path))
            if not rf.lastSynced:
                logger.info(f"{performance_name} not yet synced")

        return Response(
            orjson.dumps([r.model_dump() for r in remote_performance_folders]),
            mimetype="application/json",
        )
    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)


@api.route("/cluster-descriptor", methods=["GET"])
@with_instance
def get_cluster_descriptor(instance: Instance):
    if instance.remote_connection:
        try:
            cluster_desc_file = get_cluster_desc(instance.remote_connection)
            if not cluster_desc_file:
                return jsonify({"error": "cluster_descriptor.yaml not found"}), 404
            yaml_data = yaml.safe_load(cluster_desc_file.decode("utf-8"))
            return jsonify(yaml_data), 200

        except yaml.YAMLError as e:
            return jsonify({"error": f"Failed to parse YAML: {str(e)}"}), 400

        except RemoteConnectionException as e:
            return jsonify({"error": e.message}), e.http_status

        except Exception as e:
            return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500
    else:
        local_path = get_cluster_descriptor_path(instance)

        if not local_path:
            return jsonify({"error": "cluster_descriptor.yaml not found"}), 404

        try:
            with open(local_path) as cluster_desc_file:
                yaml_data = yaml.safe_load(cluster_desc_file)
                return jsonify(yaml_data)  # yaml_data is not compatible with orjson
        except yaml.YAMLError as e:
            return jsonify({"error": f"Failed to parse YAML: {str(e)}"}), 400

    return jsonify({"error": "Cluster descriptor not found"}), 404


@api.route("/remote/test", methods=["POST"])
def test_remote_folder():
    connection_data = request.json
    connection = RemoteConnection.model_validate(connection_data)
    statuses = []

    def add_status(status, message, detail=None):
        statuses.append(StatusMessage(status=status, message=message, detail=detail))

    def has_failures():
        return any(
            status.status != ConnectionTestStates.OK.value for status in statuses
        )

    # Test SSH Connection
    try:
        test_ssh_connection(connection)
        add_status(ConnectionTestStates.OK.value, "SSH connection established")
    except AuthenticationFailedException as e:
        # Return 422 for authentication failures
        add_status(
            ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
        )
        return jsonify([status.model_dump() for status in statuses]), e.http_status
    except RemoteConnectionException as e:
        add_status(
            ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
        )

    # Test Directory Configuration
    if not has_failures() and connection.profilerPath:
        try:
            check_remote_path_exists(connection, "profilerPath")
            add_status(ConnectionTestStates.OK.value, "Memory folder path exists")
        except AuthenticationFailedException as e:
            add_status(
                ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
            )
            return jsonify([status.model_dump() for status in statuses]), e.http_status
        except RemoteConnectionException as e:
            add_status(
                ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
            )

    # Test Directory Configuration (perf)
    if not has_failures() and connection.performancePath:
        try:
            check_remote_path_exists(connection, "performancePath")
            add_status(ConnectionTestStates.OK.value, "Performance folder path exists")
        except AuthenticationFailedException as e:
            add_status(
                ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
            )
            return jsonify([status.model_dump() for status in statuses]), e.http_status
        except RemoteConnectionException as e:
            add_status(
                ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
            )

    # Check for Project Configurations
    if not has_failures():
        try:
            check_remote_path_for_reports(connection)
        except AuthenticationFailedException as e:
            add_status(
                ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
            )
            return jsonify([status.model_dump() for status in statuses]), e.http_status
        except RemoteConnectionException as e:
            add_status(
                ConnectionTestStates.FAILED.value, e.message, getattr(e, "detail", None)
            )

    return Response(
        orjson.dumps([status.model_dump() for status in statuses]),
        mimetype="application/json",
    )


@api.route("/remote/read", methods=["POST"])
@with_instance
def read_remote_folder(instance: Instance):
    file_path = request.json.get("filePath")

    remote_connection = instance.remote_connection
    if not remote_connection:
        return Response(
            status=HTTPStatus.BAD_REQUEST,
            response="No remote connection found in instance.",
        )

    try:
        content = read_remote_file(remote_connection, remote_path=file_path)
    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)
    return Response(status=200, response=content)


@api.route("/remote/sync", methods=["POST"])
def sync_remote_folder():
    remote_dir = current_app.config["REMOTE_DATA_DIRECTORY"]
    request_body = request.get_json()

    # Check if request_body is None or not a dictionary
    if not request_body or not isinstance(request_body, dict):
        return jsonify({"error": "Invalid or missing JSON data"}), 400

    profiler = request_body.get("profiler")
    performance = request_body.get("performance", None)
    instance_id = request.args.get("instanceId", None)
    connection = RemoteConnection.model_validate(
        request_body.get("connection"), strict=False
    )

    if performance:
        performance_folder = RemoteReportFolder.model_validate(
            performance, strict=False
        )
        try:
            sync_remote_performance_folders(
                connection,
                remote_dir,
                performance=performance_folder,
                exclude_patterns=[r"/tensors(/|$)"],
                sid=instance_id,
            )

            performance_folder.lastSynced = int(time.time())

            return performance_folder.model_dump()

        except RemoteConnectionException as e:
            return Response(status=e.http_status, response=e.message)

    try:
        remote_profiler_folder = RemoteReportFolder.model_validate(
            profiler, strict=False
        )

        sync_remote_profiler_folders(
            connection,
            remote_profiler_folder.remotePath,
            remote_dir,
            exclude_patterns=[r"/tensors(/|$)"],
            sid=instance_id,
        )

        remote_profiler_folder.lastSynced = int(time.time())

        return Response(
            orjson.dumps(remote_profiler_folder.model_dump()),
            mimetype="application/json",
        )

    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)


@api.route("/remote/use", methods=["POST"])
def use_remote_folder():
    data = request.get_json(force=True)
    connection = data.get("connection", None)
    profiler = data.get("profiler", None)
    performance = data.get("performance", None)

    if not connection or not (profiler or performance):
        return Response(status=HTTPStatus.BAD_REQUEST)

    connection = RemoteConnection.model_validate(connection, strict=False)

    kwargs = {
        "instance_id": request.args.get("instanceId"),
        "remote_connection": connection,
    }

    if profiler:
        remote_profiler_folder = RemoteReportFolder.model_validate(
            profiler,
            strict=False,
        )
        kwargs["remote_profiler_folder"] = remote_profiler_folder
        kwargs["profiler_name"] = remote_profiler_folder.remotePath.split("/")[-1]

    if performance:
        remote_performance_folder = RemoteReportFolder.model_validate(
            performance,
            strict=False,
        )
        kwargs["remote_performance_folder"] = remote_performance_folder
        kwargs["performance_name"] = remote_performance_folder.reportName

    update_instance(**kwargs)

    return Response(status=HTTPStatus.OK)


@api.route("/up", methods=["GET", "POST"])
def health_check():
    return Response(status=HTTPStatus.OK)


@api.route("/instance", methods=["GET"])
@with_instance
def get_instance(instance: Instance):
    # Used to gate UI functions if no report is active
    return Response(
        orjson.dumps(instance.model_dump()),
        mimetype="application/json",
    )


@api.route("/instance", methods=["PUT"])
def update_current_instance():
    try:
        update_data = request.get_json()

        if not update_data:
            return Response(status=HTTPStatus.BAD_REQUEST, response="No data provided.")

        update_instance(
            instance_id=update_data.get("instance_id"),
            profiler_name=update_data["active_report"].get("profiler_name"),
            performance_name=update_data["active_report"].get("performance_name"),
            npe_name=update_data["active_report"].get("npe_name"),
            # Doesn't handle remote at the moment
            remote_connection=None,
            remote_profiler_folder=None,
            remote_performance_folder=None,
        )

        return Response(status=HTTPStatus.OK)
    except Exception as e:
        logger.error(f"Error updating instance: {str(e)}")

        return Response(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            response="An error occurred while updating the instance.",
        )


@api.route("/npe", methods=["GET"])
@with_instance
@timer
def get_npe_data(instance: Instance):
    if not instance.npe_path:
        logger.error("NPE path is not set in the instance.")
        return Response(status=HTTPStatus.NOT_FOUND)

    if instance.npe_path.endswith(".zst"):
        compressed_path = Path(instance.npe_path)
        uncompressed_path = None
    elif instance.npe_path.endswith(".json") or instance.npe_path.endswith(".npeviz"):
        compressed_path = None
        uncompressed_path = Path(instance.npe_path)
    else:
        compressed_path = Path(instance.npe_path)
        uncompressed_path = Path(instance.npe_path)

    if not (compressed_path and compressed_path.exists()) and not (
        uncompressed_path and uncompressed_path.exists()
    ):
        logger.error(
            f"NPE file does not exist: {compressed_path} / {uncompressed_path}"
        )
        return Response(status=HTTPStatus.NOT_FOUND)

    try:
        if compressed_path and compressed_path.exists():
            with open(compressed_path, "rb") as file:
                compressed_data = file.read()
                npe_data = zstd.uncompress(compressed_data)
        else:
            with open(uncompressed_path, "r") as file:
                npe_data = file.read()
    except Exception as e:
        logger.error(f"Error reading NPE file: {e}")
        return Response(status=HTTPStatus.UNPROCESSABLE_ENTITY)

    return Response(npe_data, mimetype="application/json")


@api.route("/notify", methods=["POST"])
def notify_report_update():
    """
    Endpoint to receive notifications about report updates and broadcast them via websockets.
    """
    from ttnn_visualizer.sockets import (
        ExitStatus,
        ReportGenerated,
        emit_report_generated,
    )

    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "No JSON data provided"}), 400

        report_name = data.get("report_name")
        exit_status_str = data.get("exit_status")

        if not report_name:
            return jsonify({"error": "report_name is required"}), 400

        # Validate status
        try:
            exit_status = (
                ExitStatus(exit_status_str.upper()) if exit_status_str else None
            )
        except ValueError:
            return (
                jsonify({"error": "Invalid exit_status."}),
                400,
            )

        # Create and emit the report update
        report_generated = ReportGenerated(
            report_name=report_name,
            exit_status=exit_status,
            profiler_path=data.get("profiler_path"),
            performance_path=data.get("performance_path"),
        )
        emit_report_generated(report_generated)

        logger.info(f"Report generated notification processed: {report_name}")

        return Response(
            orjson.dumps(
                {
                    "report_name": report_name,
                    "profiler_path": report_generated.profiler_path,
                    "performance_path": report_generated.performance_path,
                    "exit_status": exit_status.value if exit_status else None,
                    "timestamp": report_generated.timestamp,
                }
            ),
            mimetype="application/json",
        )

    except Exception as e:
        logger.error(f"Error processing report update notification: {str(e)}")
        return Response(
            orjson.dumps({"error": "Internal server error"}),
            mimetype="application/json",
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
        )
