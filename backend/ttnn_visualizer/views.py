# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import dataclasses
import json
import logging
import time
from http import HTTPStatus
from pathlib import Path
from typing import List

import yaml
from flask import Blueprint, Response, jsonify
from flask import request, current_app

from ttnn_visualizer.csv_queries import DeviceLogProfilerQueries, OpsPerformanceQueries, OpsPerformanceReportQueries
from ttnn_visualizer.decorators import with_session
from ttnn_visualizer.exceptions import DataFormatError
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import RemoteConnectionException
from ttnn_visualizer.file_uploads import (
    extract_report_name,
    extract_npe_name,
    save_uploaded_files,
    validate_files,
)
from ttnn_visualizer.models import (
    RemoteReportFolder,
    RemoteConnection,
    StatusMessage,
    Instance,
)
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.remote_sqlite_setup import get_sqlite_path, check_sqlite_path
from ttnn_visualizer.serializers import (
    serialize_operations,
    serialize_tensors,
    serialize_operation,
    serialize_buffer_pages,
    serialize_operation_buffers,
    serialize_operations_buffers,
    serialize_devices,
)
from ttnn_visualizer.sessions import (
    update_instance,
)
from ttnn_visualizer.sftp_operations import (
    sync_remote_folders,
    read_remote_file,
    check_remote_path_for_reports,
    get_remote_report_folders,
    check_remote_path_exists,
    get_remote_profiler_folders,
    sync_remote_profiler_folders,
    get_cluster_desc,
)
from ttnn_visualizer.ssh_client import get_client
from ttnn_visualizer.utils import (
    read_last_synced_file,
    timer,
)

logger = logging.getLogger(__name__)

api = Blueprint("api", __name__, url_prefix="/api")


@api.route("/operations", methods=["GET"])
@with_session
@timer
def operation_list(session):
    with DatabaseQueries(session) as db:
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

        return serialize_operations(
            inputs,
            operation_arguments,
            operations,
            outputs,
            stack_traces,
            tensors,
            devices,
            producers_consumers,
            device_operations,
        )


@api.route("/operations/<operation_id>", methods=["GET"])
@with_session
@timer
def operation_detail(operation_id, session):
    with DatabaseQueries(session) as db:

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

        return serialize_operation(
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
        )


@api.route(
    "operation-history",
    methods=[
        "GET",
    ],
)
@with_session
@timer
def operation_history(session: Instance):
    operation_history_filename = "operation_history.json"
    if session.remote_connection and session.remote_connection.useRemoteQuerying:
        if not session.remote_folder:
            return []
        operation_history = read_remote_file(
            remote_connection=session.remote_connection,
            remote_path=Path(
                session.remote_folder.remotePath, operation_history_filename
            ),
        )
        if not operation_history:
            return []
        return json.loads(operation_history)
    else:
        operation_history_file = (
            Path(str(session.report_path)).parent / operation_history_filename
        )
        if not operation_history_file.exists():
            return []
        with open(operation_history_file, "r") as file:
            return json.load(file)


@api.route("/config")
@with_session
@timer
def get_config(session: Instance):
    if session.remote_connection and session.remote_connection.useRemoteQuerying:
        if not session.remote_folder:
            return {}
        config = read_remote_file(
            remote_connection=session.remote_connection,
            remote_path=Path(session.remote_folder.remotePath, "config.json"),
        )
        if not config:
            return {}
        return config
    else:
        config_file = Path(str(session.report_path)).parent.joinpath("config.json")
        if not config_file.exists():
            return {}
        with open(config_file, "r") as file:
            return json.load(file)


@api.route("/tensors", methods=["GET"])
@with_session
@timer
def tensors_list(session: Instance):
    with DatabaseQueries(session) as db:
        device_id = request.args.get("device_id", None)
        tensors = list(db.query_tensors(filters={"device_id": device_id}))
        local_comparisons = list(db.query_tensor_comparisons())
        global_comparisons = list(db.query_tensor_comparisons(local=False))
        producers_consumers = list(db.query_producers_consumers())
        return serialize_tensors(
            tensors, producers_consumers, local_comparisons, global_comparisons
        )


@api.route("/buffer", methods=["GET"])
@with_session
@timer
def buffer_detail(session: Instance):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")

    if not address or not operation_id:
        return Response(status=HTTPStatus.BAD_REQUEST)

    if operation_id and str.isdigit(operation_id):
        operation_id = int(operation_id)
    else:
        return Response(status=HTTPStatus.BAD_REQUEST)

    with DatabaseQueries(session) as db:
        buffer = db.query_next_buffer(operation_id, address)
        if not buffer:
            return Response(status=HTTPStatus.NOT_FOUND)
        return dataclasses.asdict(buffer)


@api.route("/buffer-pages", methods=["GET"])
@with_session
@timer
def buffer_pages(session: Instance):
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

    with DatabaseQueries(session) as db:
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
        return serialize_buffer_pages(buffers)


@api.route("/tensors/<tensor_id>", methods=["GET"])
@with_session
@timer
def tensor_detail(tensor_id, session: Instance):
    with DatabaseQueries(session) as db:
        tensors = list(db.query_tensors(filters={"tensor_id": tensor_id}))
        if not tensors:
            return Response(status=HTTPStatus.NOT_FOUND)

        return dataclasses.asdict(tensors[0])


@api.route("/operation-buffers", methods=["GET"])
@with_session
def get_operations_buffers(session: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(session) as db:
        buffers = list(
            db.query_buffers(
                filters={"buffer_type": buffer_type, "device_id": device_id}
            )
        )
        operations = list(db.query_operations())
        return serialize_operations_buffers(operations, buffers)


@api.route("/operation-buffers/<operation_id>", methods=["GET"])
@with_session
def get_operation_buffers(operation_id, session: Instance):
    buffer_type = request.args.get("buffer_type", "")
    device_id = request.args.get("device_id", None)
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(session) as db:
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
        return serialize_operation_buffers(operation, buffers)


@api.route("/profiler/device-log", methods=["GET"])
@with_session
def get_profiler_data(session: Instance):
    if not session.profiler_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    with DeviceLogProfilerQueries(session) as csv:
        result = csv.get_all_entries(as_dict=True, limit=100)
        return jsonify(result)


@api.route("/profiler/perf-results", methods=["GET"])
@with_session
def get_profiler_performance_data(session: Instance):
    if not session.profiler_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    with OpsPerformanceQueries(session) as csv:
        # result = csv.query_by_op_code(op_code="(torch) contiguous", as_dict=True)
        result = csv.get_all_entries(as_dict=True, limit=100)
        return jsonify(result)


@api.route("/profiler/perf-results/raw", methods=["GET"])
@with_session
def get_profiler_perf_results_data_raw(session: Instance):
    if not session.profiler_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    content = OpsPerformanceQueries.get_raw_csv(session)
    return Response(
        content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=op_perf_results.csv"},
    )


@api.route("/profiler/perf-results/report", methods=["GET"])
@with_session
def get_profiler_perf_results_report(session: Instance):
    if not session.profiler_path:
        return Response(status=HTTPStatus.NOT_FOUND)

    try:
        report = OpsPerformanceReportQueries.generate_report(session)
    except DataFormatError:
        return Response(status=HTTPStatus.UNPROCESSABLE_ENTITY)

    return jsonify(report), 200


@api.route("/profiler/device-log/raw", methods=["GET"])
@with_session
def get_profiler_data_raw(session: Instance):
    if not session.profiler_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    content = DeviceLogProfilerQueries.get_raw_csv(session)
    return Response(
        content,
        mimetype="text/csv",
        headers={"Content-Disposition": "attachment; filename=profile_log_device.csv"},
    )


@api.route("/profiler/device-log/zone/<zone>", methods=["GET"])
@with_session
def get_zone_statistics(zone, session: Instance):
    if not session.profiler_path:
        return Response(status=HTTPStatus.NOT_FOUND)
    with DeviceLogProfilerQueries(session) as csv:
        result = csv.query_zone_statistics(zone_name=zone, as_dict=True)
        return jsonify(result)


@api.route("/devices", methods=["GET"])
@with_session
def get_devices(session: Instance):
    with DatabaseQueries(session) as db:
        devices = list(db.query_devices())
        return serialize_devices(devices)


@api.route("/local/upload/report", methods=["POST"])
def create_report_files():
    files = request.files.getlist("files")
    report_directory = current_app.config["LOCAL_DATA_DIRECTORY"]

    if not validate_files(files, {"db.sqlite", "config.json"}):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Invalid project directory.",
        ).model_dump()

    report_name = extract_report_name(files)
    logger.info(f"Writing report files to {report_directory}/{report_name}")

    save_uploaded_files(files, report_directory, report_name)

    instance_id = request.args.get("instanceId")
    update_instance(instance_id=instance_id, report_name=report_name, clear_remote=True)

    return StatusMessage(
        status=ConnectionTestStates.OK, message="Success."
    ).model_dump()

@api.route("/local/upload/profile", methods=["POST"])
def create_profile_files():
    files = request.files.getlist("files")
    report_directory = Path(current_app.config["LOCAL_DATA_DIRECTORY"])
    instance_id = request.args.get("instanceId")

    if not validate_files(
        files,
        {"profile_log_device.csv", "tracy_profile_log_host.tracy"},
        pattern="ops_perf_results",
    ):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Invalid project directory.",
        ).model_dump()

    logger.info(f"Writing profile files to {report_directory} / 'profiles'")

    # Construct the base directory with report_name first
    target_directory = report_directory / "profiles"
    target_directory.mkdir(parents=True, exist_ok=True)

    if files:
        first_file_path = Path(files[0].filename)
        profiler_folder_name = first_file_path.parts[0]
    else:
        profiler_folder_name = None

    updated_files = []
    for file in files:
        original_path = Path(file.filename)
        updated_path = target_directory / original_path
        updated_path.parent.mkdir(parents=True, exist_ok=True)
        file.filename = str(updated_path)
        updated_files.append(file)

    save_uploaded_files(
        updated_files,
        str(report_directory),
    )

    update_instance(
        instance_id=instance_id, profile_name=profiler_folder_name, clear_remote=True
    )

    return StatusMessage(
        status=ConnectionTestStates.OK, message="Success."
    ).model_dump()


@api.route("/local/upload/npe", methods=["POST"])
def create_npe_files():
    files = request.files.getlist("files")
    report_directory = current_app.config["LOCAL_DATA_DIRECTORY"]

    for file in files:
        if not file.filename.endswith(".json"):
            return StatusMessage(
                status=ConnectionTestStates.FAILED,
                message="NPE requires a valid JSON file",
            ).model_dump()

    npe_name = extract_npe_name(files)
    target_directory = report_directory / "npe"
    target_directory.mkdir(parents=True, exist_ok=True)

    save_uploaded_files(files, target_directory, npe_name)

    instance_id = request.args.get("instanceId")
    update_instance(instance_id=instance_id, npe_name=npe_name, clear_remote=True)

    return StatusMessage(
        status=ConnectionTestStates.OK, message="Success"
    ).model_dump()

@api.route("/remote/folder", methods=["POST"])
def get_remote_folders():
    connection = RemoteConnection.model_validate(request.json, strict=False)
    try:
        remote_folders: List[RemoteReportFolder] = get_remote_report_folders(
            RemoteConnection.model_validate(connection, strict=False)
        )

        for rf in remote_folders:
            directory_name = Path(rf.remotePath).name
            remote_data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
            local_path = (
                Path(remote_data_directory)
                .joinpath(connection.host)
                .joinpath(directory_name)
            )
            logger.info(f"Checking last synced for {directory_name}")
            rf.lastSynced = read_last_synced_file(str(local_path))
            if not rf.lastSynced:
                logger.info(f"{directory_name} not yet synced")

        return [r.model_dump() for r in remote_folders]
    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)


@api.route("/remote/profiles", methods=["POST"])
def get_remote_profile_folders():
    request_body = request.get_json()
    connection = RemoteConnection.model_validate(
        request_body.get("connection"), strict=False
    )

    try:
        remote_profile_folders: List[RemoteReportFolder] = get_remote_profiler_folders(
            RemoteConnection.model_validate(connection, strict=False)
        )

        for rf in remote_profile_folders:
            profile_name = Path(rf.remotePath).name
            remote_data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
            local_path = (
                Path(remote_data_directory)
                .joinpath(connection.host)
                .joinpath("profiler")
                .joinpath(profile_name)
            )
            logger.info(f"Checking last synced for {profile_name}")
            rf.lastSynced = read_last_synced_file(str(local_path))
            if not rf.lastSynced:
                logger.info(f"{profile_name} not yet synced")

        return [r.model_dump() for r in remote_profile_folders]
    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)


from flask import Response, jsonify
import yaml


@api.route("/cluster_desc", methods=["GET"])
@with_session
def get_cluster_description_file(session: Instance):
    if not session.remote_connection:
        return jsonify({"error": "Remote connection not found"}), 404

    try:
        cluster_desc_file = get_cluster_desc(session.remote_connection)
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


@api.route("/remote/test", methods=["POST"])
def test_remote_folder():
    connection_data = request.json
    connection = RemoteConnection.model_validate(connection_data)
    statuses = []

    def add_status(status, message):
        statuses.append(StatusMessage(status=status, message=message))

    def has_failures():
        return any(
            status.status != ConnectionTestStates.OK.value for status in statuses
        )

    # Test SSH Connection
    try:
        get_client(connection)
        add_status(ConnectionTestStates.OK.value, "SSH connection established")
    except RemoteConnectionException as e:
        add_status(ConnectionTestStates.FAILED.value, e.message)

    # Test Directory Configuration
    if not has_failures():
        try:
            check_remote_path_exists(connection, "reportPath")
            add_status(ConnectionTestStates.OK.value, "Report folder path exists")
        except RemoteConnectionException as e:
            add_status(ConnectionTestStates.FAILED.value, e.message)

    # Test Directory Configuration (perf)
    if not has_failures() and connection.performancePath:
        try:
            check_remote_path_exists(connection, "performancePath")
            add_status(ConnectionTestStates.OK.value, "Performance folder path exists")
        except RemoteConnectionException as e:
            add_status(ConnectionTestStates.FAILED.value, e.message)

    # Check for Project Configurations
    if not has_failures():
        try:
            check_remote_path_for_reports(connection)
        except RemoteConnectionException as e:
            add_status(ConnectionTestStates.FAILED.value, e.message)

    # Test Sqlite binary path configuration
    if not has_failures() and connection.useRemoteQuerying:
        if not connection.sqliteBinaryPath:
            add_status(ConnectionTestStates.FAILED, "SQLite binary path not provided")
        else:
            try:
                check_sqlite_path(connection)
                add_status(ConnectionTestStates.OK, "SQLite binary found.")
            except RemoteConnectionException as e:
                add_status(ConnectionTestStates.FAILED, e.message)

    return [status.model_dump() for status in statuses]


@api.route("/remote/read", methods=["POST"])
def read_remote_folder():
    connection = RemoteConnection.model_validate(request.json, strict=False)
    try:
        content = read_remote_file(connection, remote_path=connection.path)
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

    folder = request_body.get("folder")
    profile = request_body.get("profile", None)
    instance_id = request.args.get("instanceId", None)
    connection = RemoteConnection.model_validate(
        request_body.get("connection"), strict=False
    )

    if profile:
        profile_folder = RemoteReportFolder.model_validate(profile, strict=False)
        try:
            sync_remote_profiler_folders(
                connection,
                remote_dir,
                profile=profile_folder,
                exclude_patterns=[r"/tensors(/|$)"],
                sid=instance_id,
            )

            profile_folder.lastSynced = int(time.time())

            return profile_folder.model_dump()

        except RemoteConnectionException as e:
            return Response(status=e.http_status, response=e.message)

    try:
        remote_folder = RemoteReportFolder.model_validate(folder, strict=False)

        sync_remote_folders(
            connection,
            remote_folder.remotePath,
            remote_dir,
            exclude_patterns=[r"/tensors(/|$)"],
            sid=instance_id,
        )

        remote_folder.lastSynced = int(time.time())

        return remote_folder.model_dump()

    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)


@api.route("/remote/sqlite/detect-path", methods=["POST"])
def detect_sqlite_path():
    connection = request.json
    connection = RemoteConnection.model_validate(connection, strict=False)
    status_message = StatusMessage(
        status=ConnectionTestStates.OK, message="Unable to Detect Path"
    )
    try:
        path = get_sqlite_path(connection=connection)
        if path:
            status_message = StatusMessage(status=ConnectionTestStates.OK, message=path)
        else:
            status_message = StatusMessage(
                status=ConnectionTestStates.OK, message="Unable to Detect Path"
            )
    except RemoteConnectionException as e:
        current_app.logger.error(f"Unable to detect SQLite3 path {str(e)}")
        status_message = StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Unable to detect SQLite3 path. See logs",
        )
    finally:
        return status_message.model_dump()


@api.route("/remote/use", methods=["POST"])
def use_remote_folder():
    data = request.get_json(force=True)
    connection = data.get("connection", None)
    folder = data.get("folder", None)
    profile = data.get("profile", None)

    if not connection or not folder:
        return Response(status=HTTPStatus.BAD_REQUEST)

    connection = RemoteConnection.model_validate(connection, strict=False)
    folder = RemoteReportFolder.model_validate(folder, strict=False)
    profile_name = None
    remote_profile_folder = None
    if profile:
        remote_profile_folder = RemoteReportFolder.model_validate(profile, strict=False)
        profile_name = remote_profile_folder.testName
    report_data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
    report_folder = Path(folder.remotePath).name

    connection_directory = Path(report_data_directory, connection.host, report_folder)

    if not connection.useRemoteQuerying and not connection_directory.exists():
        return Response(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            response=f"{connection_directory} does not exist.",
        )

    remote_path = f"{Path(report_data_directory).name}/{connection.host}/{connection_directory.name}"

    instance_id = request.args.get("instanceId")
    current_app.logger.info(f"Setting active report for {instance_id} - {remote_path}")

    update_instance(
        instance_id=instance_id,
        report_name=report_folder,
        profile_name=profile_name,
        remote_connection=connection,
        remote_folder=folder,
        remote_profile_folder=remote_profile_folder,
    )

    return Response(status=HTTPStatus.OK)


@api.route("/up", methods=["GET", "POST"])
def health_check():
    return Response(status=HTTPStatus.OK)


@api.route("/session", methods=["GET"])
@with_session
def get_instance(session: Instance):
    # Used to gate UI functions if no report is active
    return session.model_dump()

@api.route("/npe", methods=["GET"])
@with_session
@timer
def get_npe_data(session: Instance):
    if not session.npe_path:
        logger.error("NPE path is not set in the session.")
        return Response(status=HTTPStatus.NOT_FOUND)

    npe_file = Path(f"{session.npe_path}/{session.active_report.npe_name}.json")
    if not npe_file.exists():
        logger.error(f"NPE file does not exist: {npe_file}")
        return Response(status=HTTPStatus.NOT_FOUND)
    with open(npe_file, "r") as file:
        npe_data = json.load(file)
    return jsonify(npe_data)
