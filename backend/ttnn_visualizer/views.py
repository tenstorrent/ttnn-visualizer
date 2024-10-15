import dataclasses
import json

from flask import Blueprint, Response

from ttnn_visualizer.decorators import with_report_path
from ttnn_visualizer.exceptions import RemoteFolderException
from ttnn_visualizer.models import RemoteFolder, RemoteConnection, StatusMessage
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.sockets import (
    FileProgress,
    emit_file_status,
    FileStatus,
)
from flask import request, current_app
from pathlib import Path
from http import HTTPStatus
import logging
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
    get_or_create_tab_session,
)
from ttnn_visualizer.sftp_operations import (
    sync_test_folders,
    read_remote_file,
    check_remote_path,
    get_remote_test_folders,
)
from ttnn_visualizer.utils import timer

logger = logging.getLogger(__name__)

api = Blueprint("api", __name__, url_prefix="/api")


@api.route("/operations", methods=["GET"])
@with_report_path
@timer
def operation_list(report_path):
    with DatabaseQueries(report_path) as db:
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
@with_report_path
@timer
def operation_detail(operation_id, report_path):
    with DatabaseQueries(report_path) as db:
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
@with_report_path
@timer
def operation_history(report_path):

    operation_history_filename = "operation_history.json"
    operation_history_file = Path(report_path).parent / operation_history_filename
    if not operation_history_file.exists():
        return []
    with open(operation_history_file, "r") as file:
        return json.load(file)


@api.route("/config")
@with_report_path
@timer
def get_config(report_path):
    config_file = Path(report_path).parent.joinpath("config.json")
    if not config_file.exists():
        return {}
    with open(config_file, "r") as file:
        return json.load(file)


@api.route("/tensors", methods=["GET"])
@with_report_path
@timer
def tensors_list(report_path):
    with DatabaseQueries(report_path) as db:
        tensors = list(db.query_tensors())
        producers_consumers = list(db.query_producers_consumers())
        return serialize_tensors(tensors, producers_consumers)


@api.route("/buffer", methods=["GET"])
@with_report_path
@timer
def buffer_detail(report_path):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")

    if not address or not operation_id:
        return Response(status=HTTPStatus.BAD_REQUEST)

    with DatabaseQueries(report_path) as db:
        buffer = db.query_next_buffer(operation_id, address)
        if not buffer:
            return Response(status=HTTPStatus.NOT_FOUND)
        return dataclasses.asdict(buffer)


@api.route("/buffer-pages", methods=["GET"])
@with_report_path
@timer
def buffer_pages(report_path):
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")
    buffer_type = request.args.get("buffer_type", "")

    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(report_path) as db:
        buffers = list(db.query_buffer_pages(operation_id, address, buffer_type))
        return serialize_buffer_pages(buffers)


@api.route("/tensors/<tensor_id>", methods=["GET"])
@with_report_path
@timer
def tensor_detail(tensor_id, report_path):

    with DatabaseQueries(report_path) as db:
        tensor = db.query_tensor_by_id(tensor_id)
        if not tensor:
            return Response(status=HTTPStatus.NOT_FOUND)

        return dataclasses.asdict(tensor)


@api.route("/operation-buffers", methods=["GET"])
@with_report_path
def get_operations_buffers(report_path):

    buffer_type = request.args.get("buffer_type", "")
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(report_path) as db:
        buffers = list(db.query_buffers(buffer_type=buffer_type))
        operations = list(db.query_operations())
        return serialize_operations_buffers(operations, buffers)


@api.route("/operation-buffers/<operation_id>", methods=["GET"])
@with_report_path
def get_operation_buffers(operation_id, report_path):

    buffer_type = request.args.get("buffer_type", "")
    if buffer_type and str.isdigit(buffer_type):
        buffer_type = int(buffer_type)
    else:
        buffer_type = None

    with DatabaseQueries(report_path) as db:
        operation = db.query_operation_by_id(operation_id)
        buffers = list(
            db.query_buffers_by_operation_id(operation_id, buffer_type=buffer_type)
        )
        if not operation:
            return Response(status=HTTPStatus.NOT_FOUND)
        return serialize_operation_buffers(operation, buffers)


@api.route("/devices", methods=["GET"])
@with_report_path
def get_devices(report_path):
    with DatabaseQueries(report_path) as db:
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
    files = request.files.getlist("files")
    local_dir = current_app.config["LOCAL_DATA_DIRECTORY"]
    filenames = [Path(f.filename).name for f in files]

    logger.info(f"Received files: {filenames}")

    # Validate necessary files
    if "db.sqlite" not in filenames or "config.json" not in filenames:
        return StatusMessage(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            message="Invalid project directory.",
        ).model_dump()

    report_name = files[0].filename.split("/")[0]
    report_directory = Path(local_dir)
    logger.info(f"Writing report files to {report_directory}/{report_name}")

    total_files = len(files)
    processed_files = 0
    tab_id = request.args.get("tabId")

    for index, file in enumerate(files):
        current_file_name = file.filename
        logger.info(f"Processing file: {current_file_name}")

        destination_file = Path(report_directory, Path(current_file_name))
        logger.info(f"Writing file to {destination_file}")

        # Create the directory if it doesn't exist
        if not destination_file.parent.exists():
            logger.info(
                f"{destination_file.parent.name} does not exist. Creating directory"
            )
            destination_file.parent.mkdir(exist_ok=True, parents=True)

        # Emit 0% progress at the start
        progress = FileProgress(
            current_file_name=current_file_name,
            number_of_files=total_files,
            percent_of_current=0,
            finished_files=processed_files,
            status=FileStatus.DOWNLOADING,
        )
        emit_file_status(progress, tab_id)

        # Save the file locally
        file.save(destination_file)

        # Emit 100% progress after file is saved
        processed_files += 1
        progress.percent_of_current = 100
        progress.finished_files = processed_files
        emit_file_status(progress, tab_id)

    # Update the session after all files are uploaded
    update_tab_session(tab_id=tab_id, active_report_data={"name": report_name})

    # Emit final success status after all files are processed
    final_progress = FileProgress(
        current_file_name=None,
        number_of_files=total_files,
        percent_of_current=100,
        finished_files=processed_files,
        status=FileStatus.FINISHED,
    )
    emit_file_status(final_progress, tab_id)

    return StatusMessage(status=HTTPStatus.OK, message="Success.").model_dump()


@api.route("/remote/folder", methods=["POST"])
def get_remote_folders():
    connection = request.json
    try:
        remote_folders = get_remote_test_folders(RemoteConnection(**connection))
        return [r.model_dump() for r in remote_folders]
    except RemoteFolderException as e:
        return Response(status=e.status, response=e.message)


@api.route("/remote/test", methods=["POST"])
def test_remote_folder():
    connection = request.json
    try:
        check_remote_path(RemoteConnection(**connection))
    except RemoteFolderException as e:
        return Response(status=e.status, response=e.message)
    return Response(status=HTTPStatus.OK)


@api.route("/remote/read", methods=["POST"])
def read_remote_folder():
    connection = request.json
    try:
        content = read_remote_file(RemoteConnection(**connection))
    except RemoteFolderException as e:
        return Response(status=e.status, response=e.message)
    return Response(status=200, response=content)


@api.route("/remote/sync", methods=["POST"])
def sync_remote_folder():
    remote_dir = current_app.config["REMOTE_DATA_DIRECTORY"]
    request_body = request.json
    connection = request_body.get("connection")
    folder = request_body.get("folder")
    tab_id = request.args.get("tabId", None)
    try:
        sync_test_folders(
            RemoteConnection(**connection),
            RemoteFolder(**folder),
            remote_dir,
            sid=tab_id,
        )
    except RemoteFolderException as e:
        return Response(status=e.status, response=e.message)
    return Response(status=HTTPStatus.OK)


@api.route("/remote/use", methods=["POST"])
def use_remote_folder():
    connection = request.json.get("connection", None)
    folder = request.json.get("folder", None)
    if not connection or not folder:
        return Response(status=HTTPStatus.BAD_REQUEST)

    connection = RemoteConnection(**connection)
    folder = RemoteFolder(**folder)
    report_data_directory = current_app.config["REMOTE_DATA_DIRECTORY"]
    report_folder = Path(folder.remotePath).name
    connection_directory = Path(report_data_directory, connection.host, report_folder)

    if not connection_directory.exists():
        return Response(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            response=f"{connection_directory} does not exist.",
        )

    # Set Active Report on View
    remote_path = f"{Path(report_data_directory).name}/{connection.host}/{connection_directory.name}"

    tab_id = request.args.get("tabId")
    current_app.logger.info(f"Setting active report for {tab_id} - {remote_path}")

    update_tab_session(
        tab_id=tab_id,
        active_report_data={"name": report_folder},
        remote_connection_data=connection.dict(),
    )

    return Response(status=HTTPStatus.OK)


@api.route("/up", methods=["GET", "POST"])
def health_check():
    return Response(status=HTTPStatus.OK)


@api.route("/reports/active", methods=["GET"])
def get_active_folder():
    # Used to gate UI functions if no report is active

    tab_id = request.args.get("tabId", None)
    current_app.logger.info(f"TabID: {tab_id}")
    if tab_id:
        session, created = get_or_create_tab_session(
            tab_id=tab_id
        )  # Capture both the session and created flag
        current_app.logger.info(f"Session: {session}")
        if session and session.get("active_report", None):
            active_report = session.get("active_report")
            return {
                "name": active_report.get("name"),
                "remote_connection": active_report.get("remote_connection", None),
            }

    return {"name": None, "host": None}
