import dataclasses
import io
import json
import logging
import time
from http import HTTPStatus
from multiprocessing.managers import Value
from pathlib import Path
from typing import List

import torch
from flask import Blueprint, Response, jsonify
from flask import request, current_app
from sqlalchemy.exc import NoSuchModuleError

from ttnn_visualizer.decorators import with_session
from ttnn_visualizer.enums import ConnectionTestStates
from ttnn_visualizer.exceptions import RemoteConnectionException
from ttnn_visualizer.models import (
    RemoteReportFolder,
    RemoteConnection,
    StatusMessage,
    TabSession,
    TensorComparisonRecord,
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
    update_tab_session,
)
from ttnn_visualizer.sftp_operations import (
    sync_remote_folders,
    read_remote_file,
    check_remote_path_for_reports,
    get_remote_report_folders,
    check_remote_path_exists,
)
from ttnn_visualizer.sockets import (
    FileProgress,
    emit_file_status,
    FileStatus,
)
from ttnn_visualizer.ssh_client import get_client
from ttnn_visualizer.tensor_comparison import TensorComparator
from ttnn_visualizer.utils import (
    read_last_synced_file,
    timer,
    make_torch_json_serializable,
    compare_tensors,
    read_remote_tensor,
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
        operation = db.query_operation_by_id(operation_id)

        if not operation:
            return Response(status=HTTPStatus.NOT_FOUND)

        buffers = list(db.query_buffers_by_operation_id(operation_id))
        operation_arguments = list(
            db.query_operation_arguments_by_operation_id(operation_id)
        )
        stack_trace = db.query_stack_trace(operation_id)

        inputs = list(db.query_input_tensors_by_operation_id(operation_id))
        outputs = list(db.query_output_tensors_by_operation_id(operation_id))

        input_tensor_ids = [i.tensor_id for i in inputs]
        output_tensor_ids = [o.tensor_id for o in outputs]
        tensor_ids = input_tensor_ids + output_tensor_ids
        tensors = list(db.query_tensors_by_tensor_ids(tensor_ids))
        local_comparisons = list(
            db.query_local_tensor_comparisons_by_tensor_ids(tensor_ids)
        )

        global_comparisons = list(
            db.query_global_tensor_comparisons_by_tensor_ids(tensor_ids)
        )

        device_operations = db.query_device_operations_by_operation_id(operation_id)

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
def operation_history(session: TabSession):

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
def get_config(session: TabSession):

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
def tensors_list(session: TabSession):
    with DatabaseQueries(session) as db:
        tensors = list(db.query_tensors())
        producers_consumers = list(db.query_producers_consumers())
        return serialize_tensors(tensors, producers_consumers)


@api.route("/buffer", methods=["GET"])
@with_session
@timer
def buffer_detail(session: TabSession):
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
def buffer_pages(session: TabSession):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")
    buffer_type = request.args.get("buffer_type", "")

    if address:
        addresses = [addr.strip() for addr in address.split(",")]
    else:
        addresses = None

    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(session) as db:
        buffers = list(db.query_buffer_pages(operation_id, addresses, buffer_type))
        return serialize_buffer_pages(buffers)


@api.route("/tensors/<tensor_id>", methods=["GET"])
@with_session
@timer
def tensor_detail(tensor_id, session: TabSession):

    with DatabaseQueries(session) as db:
        tensor = db.query_tensor_by_id(tensor_id)
        if not tensor:
            return Response(status=HTTPStatus.NOT_FOUND)

        return dataclasses.asdict(tensor)


@api.route("/operation-buffers", methods=["GET"])
@with_session
def get_operations_buffers(session: TabSession):

    buffer_type = request.args.get("buffer_type", "")
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(session) as db:
        buffers = list(db.query_buffers(buffer_type=buffer_type))
        operations = list(db.query_operations())
        return serialize_operations_buffers(operations, buffers)


@api.route("/read-tensor/<tensor_id>", methods=["GET"])
@with_session
def read_tensor(tensor_id, session: TabSession):
    local = request.args.get("local", False)
    with DatabaseQueries(session) as db:
        comparator = TensorComparator(session=session, db=db)
        try:
            comparison_data = comparator.get_tensor_json(tensor_id)
            return comparison_data
        except RemoteConnectionException as e:
            return Response(str(e), status=HTTPStatus.BAD_REQUEST)
        except ValueError as e:
            return Response(str(e), status=HTTPStatus.BAD_REQUEST)


@api.route("/compare-tensors/<tensor_id>", methods=["GET"])
@with_session
def compare_tensor(tensor_id, session: TabSession):
    local = request.args.get("local", False)
    with DatabaseQueries(session) as db:
        comparator = TensorComparator(session=session, db=db)
        try:
            comparison_data = comparator.get_comparison_json(tensor_id, local)
            return comparison_data
        except RemoteConnectionException as e:
            return Response(str(e), status=HTTPStatus.BAD_REQUEST)
        except ValueError as e:
            return Response(str(e), status=HTTPStatus.BAD_REQUEST)
        except ModuleNotFoundError as e:
            return Response(str(e), status=HTTPStatus.BAD_REQUEST)


@api.route("/operation-buffers/<operation_id>", methods=["GET"])
@with_session
def get_operation_buffers(operation_id, session: TabSession):

    buffer_type = request.args.get("buffer_type", "")
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(session) as db:
        operation = db.query_operation_by_id(operation_id)
        buffers = list(
            db.query_buffers_by_operation_id(operation_id, buffer_type=buffer_type)
        )
        if not operation:
            return Response(status=HTTPStatus.NOT_FOUND)
        return serialize_operation_buffers(operation, buffers)


@api.route("/devices", methods=["GET"])
@with_session
def get_devices(session: TabSession):
    with DatabaseQueries(session) as db:
        devices = list(db.query_devices())
        return serialize_devices(devices)


@api.route(
    "/local/upload",
    methods=[
        "POST",
    ],
)
def create_upload_files():
    """Handle file uploads and emit progress for each file."""

    def validate_uploaded_report_files(files):
        """Ensure specific files exist and have only one parent folder in their paths."""
        found_files = set()
        report_files = {"db.sqlite", "config.json"}

        for file in files:
            file_path = Path(file.filename)
            if file_path.name in report_files:
                found_files.add(file_path.name)
                # Check that the file path has exactly one parent folder
                if (
                    len(file_path.parents) != 2
                ):  # `2` means one parent folder plus the file itself
                    logger.warning(
                        f"File {file.filename} is not under a single parent folder."
                    )
                    return False

        # Check if all specific files are found
        missing_files = report_files - found_files
        if missing_files:
            logger.warning(f"Missing required files: {', '.join(missing_files)}")
            return False

        return True

    def emit_file_progress(
        current_file_name, total_files, processed_files, percent, status, tab_id
    ):
        """Emit progress for a specific file."""
        progress = FileProgress(
            current_file_name=current_file_name,
            number_of_files=total_files,
            percent_of_current=percent,
            finished_files=processed_files,
            status=status,
        )
        if current_app.config["USE_WEBSOCKETS"]:
            emit_file_status(progress, tab_id)

    def emit_final_file_progress(total_files, processed_files, tab_id):
        """Emit final progress status after all files are processed."""
        final_progress = FileProgress(
            current_file_name="",
            number_of_files=total_files,
            percent_of_current=100,
            finished_files=processed_files,
            status=FileStatus.FINISHED,
        )
        if current_app.config["USE_WEBSOCKETS"]:
            emit_file_status(final_progress, tab_id)

    def get_report_name_from_files(files):
        """Extract the report name from the first file and return the report directory path."""
        unsplit_report_name = str(files[0].filename)
        report_name = unsplit_report_name.split("/")[0]

        return report_name

    files = request.files.getlist("files")

    if not validate_uploaded_report_files(files):
        return StatusMessage(
            status=ConnectionTestStates.FAILED,
            message="Invalid project directory.",
        ).model_dump()

    report_directory = current_app.config["LOCAL_DATA_DIRECTORY"]
    report_name = get_report_name_from_files(files)

    logger.info(f"Writing report files to {report_directory}/{report_name}")

    total_files = len(files)
    processed_files = 0
    tab_id = request.args.get("tabId")

    for index, file in enumerate(files):
        current_file_name = str(file.filename)
        logger.info(f"Processing file: {current_file_name}")

        destination_file = Path(report_directory).joinpath((str(current_file_name)))
        logger.info(f"Writing file to {destination_file}")

        # Create the directory if it doesn't exist
        if not destination_file.parent.exists():
            logger.info(
                f"{destination_file.parent.name} does not exist. Creating directory"
            )
            destination_file.parent.mkdir(exist_ok=True, parents=True)

        # Emit progress on each file save
        emit_file_progress(
            current_file_name,
            total_files,
            processed_files,
            0,
            FileStatus.DOWNLOADING,
            tab_id,
        )

        file.save(destination_file)

        processed_files += 1
        emit_file_progress(
            current_file_name,
            total_files,
            processed_files,
            100,
            FileStatus.DOWNLOADING,
            tab_id,
        )

    # Update the session after all files are uploaded
    update_tab_session(tab_id=tab_id, active_report_data={"name": report_name})
    emit_final_file_progress(total_files, processed_files, tab_id)

    return StatusMessage(
        status=ConnectionTestStates.OK, message="Success."
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
        add_status(ConnectionTestStates.OK.value, "SSH connection established.")
    except RemoteConnectionException as e:
        add_status(ConnectionTestStates.FAILED.value, e.message)

    # Test Directory Configuration
    if not has_failures():
        try:
            check_remote_path_exists(connection)
            add_status(ConnectionTestStates.OK.value, "Remote folder path exists.")
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
    tab_id = request.args.get("tabId", None)
    connection = RemoteConnection.model_validate(
        request_body.get("connection"), strict=False
    )
    remote_folder = RemoteReportFolder.model_validate(folder, strict=False)
    try:
        sync_remote_folders(
            connection,
            remote_folder.remotePath,
            remote_dir,
            exclude_patterns=[r"/tensors(/|$)"],
            sid=tab_id,
        )
    except RemoteConnectionException as e:
        return Response(status=e.http_status, response=e.message)

    remote_folder.lastSynced = int(time.time())
    return remote_folder.model_dump()


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
    if not connection or not folder:
        return Response(status=HTTPStatus.BAD_REQUEST)
    connection = RemoteConnection.model_validate(connection, strict=False)
    folder = RemoteReportFolder.model_validate(folder, strict=False)
    report_data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
    report_folder = Path(folder.remotePath).name
    connection_directory = Path(report_data_directory, connection.host, report_folder)

    if not connection.useRemoteQuerying and not connection_directory.exists():
        return Response(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            response=f"{connection_directory} does not exist.",
        )

    remote_path = f"{Path(report_data_directory).name}/{connection.host}/{connection_directory.name}"

    tab_id = request.args.get("tabId")
    current_app.logger.info(f"Setting active report for {tab_id} - {remote_path}")

    update_tab_session(
        tab_id=tab_id,
        active_report_data={"name": report_folder},
        remote_connection=connection,
        remote_folder=folder,
    )

    return Response(status=HTTPStatus.OK)


@api.route("/up", methods=["GET", "POST"])
def health_check():
    return Response(status=HTTPStatus.OK)


@api.route("/session", methods=["GET"])
@with_session
def get_tab_session(session: TabSession):
    # Used to gate UI functions if no report is active
    return session.model_dump()
