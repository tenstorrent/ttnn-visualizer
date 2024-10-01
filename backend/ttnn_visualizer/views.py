import dataclasses
import json
import logging
import sqlite3
from http import HTTPStatus
from pathlib import Path

from flask import Blueprint, Response, current_app, request
from ttnn_visualizer.sessions import CustomRequest, ActiveReport

from ttnn_visualizer.remotes import (
    RemoteConnection,
    RemoteFolder,
    RemoteFolderException,
    StatusMessage,
    check_remote_path,
    get_remote_test_folders,
    read_remote_file,
    sync_test_folders,
)
from ttnn_visualizer.serializers import (
    serialize_operations,
    serialize_tensors,
    serialize_operation,
)
from ttnn_visualizer.sessions import update_tab_session
from ttnn_visualizer.utils import timer
from ttnn_visualizer import queries

logger = logging.getLogger(__name__)

api = Blueprint("api", __name__, url_prefix="/api")


@api.route("/up", methods=["GET", "POST"])
def health_check():
    return Response(status=HTTPStatus.OK)


@api.route("/operations", methods=["GET"])
@timer
def operation_list():
    target_report_path = getattr(request, "report_path", None)

    if not target_report_path or not Path(target_report_path).exists():
        return Response(status=HTTPStatus.BAD_REQUEST)

    with sqlite3.connect(target_report_path) as conn:
        cursor = conn.cursor()
        operations = list(queries.query_operations(cursor))
        operations.sort(key=lambda o: o.operation_id)
        operation_arguments = list(queries.query_operation_arguments(cursor))
        device_operations = list(queries.query_device_operations(cursor))
        stack_traces = list(queries.query_stack_traces(cursor))
        outputs = list(queries.query_output_tensors(cursor))
        tensors = list(queries.query_tensors(cursor))
        inputs = list(queries.query_input_tensors(cursor))
        devices = list(queries.query_devices(cursor))
        producers_consumers = list(queries.query_producers_consumers(cursor))

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
@timer
def operation_detail(
    operation_id,
):
    target_report_path = getattr(request, "report_path", None)

    if not target_report_path or not Path(target_report_path).exists():
        return Response(status=HTTPStatus.BAD_REQUEST)

    with sqlite3.connect(target_report_path) as conn:
        cursor = conn.cursor()
        operation = queries.query_operation_by_id(cursor, operation_id)

        if not operation:
            return Response(status=HTTPStatus.NOT_FOUND)

        buffers = queries.query_buffers(cursor, operation_id)
        operation_arguments = queries.query_operation_arguments_by_operation_id(
            cursor, operation_id
        )
        stack_trace = queries.query_stack_trace(cursor, operation_id)

        inputs = list(queries.query_input_tensors_by_operation_id(cursor, operation_id))
        outputs = list(
            queries.query_output_tensors_by_operation_id(cursor, operation_id)
        )
        input_tensor_ids = [i.tensor_id for i in inputs]
        output_tensor_ids = [o.tensor_id for o in outputs]
        tensor_ids = input_tensor_ids + output_tensor_ids
        tensors = list(queries.query_tensors_by_tensor_ids(cursor, tensor_ids))
        device_operations = queries.query_device_operations_by_operation_id(
            cursor, operation_id
        )

        producers_consumers = list(
            filter(
                lambda pc: pc.tensor_id in tensor_ids,
                queries.query_producers_consumers(cursor),
            )
        )

        devices = list(queries.query_devices(cursor))

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
def operation_history():

    target_report_path = getattr(request, "report_path", None)

    operation_history_filename = "operation_history.json"
    operation_history_file = (
        Path(target_report_path).parent / operation_history_filename
    )
    if not operation_history_file.exists():
        return []
    with open(operation_history_file, "r") as file:
        return json.load(file)


@api.route("/config")
def get_config():

    target_report_path = getattr(request, "report_path", None)
    if not target_report_path or not Path(target_report_path).exists():
        return Response(status=HTTPStatus.BAD_REQUEST)

    config_file = Path(target_report_path).parent.joinpath("config.json")
    if not config_file.exists():
        return {}
    with open(config_file, "r") as file:
        return json.load(file)


@api.route("/tensors", methods=["GET"])
@timer
def tensors_list():
    target_report_path = getattr(request, "report_path", None)
    if not target_report_path or not Path(target_report_path).exists():
        return Response(status=HTTPStatus.BAD_REQUEST)

    with sqlite3.connect(target_report_path) as conn:
        cursor = conn.cursor()
        tensors = list(queries.query_tensors(cursor))
        producers_consumers = list(queries.query_producers_consumers(cursor))
        return serialize_tensors(tensors, producers_consumers)


@api.route("/buffer", methods=["GET"])
@timer
def buffer_detail():
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")

    if not address or not operation_id:
        return Response(status=HTTPStatus.BAD_REQUEST)

    target_report_path = getattr(request, "report_path", None)
    if not target_report_path or not Path(target_report_path).exists():
        return Response(status=HTTPStatus.BAD_REQUEST)

    with sqlite3.connect(target_report_path) as conn:
        cursor = conn.cursor()
        buffer = queries.query_next_buffer(cursor, operation_id, address)
        if not buffer:
            return Response(status=HTTPStatus.NOT_FOUND)
        return dataclasses.asdict(buffer)


@api.route("/tensors/<tensor_id>", methods=["GET"])
@timer
def tensor_detail(tensor_id):
    target_report_path = getattr(request, "report_path", None)
    if not target_report_path or not Path(target_report_path).exists():
        return Response(status=HTTPStatus.BAD_REQUEST)

    with sqlite3.connect(target_report_path) as conn:
        cursor = conn.cursor()
        tensor = queries.query_tensor_by_id(cursor, tensor_id)
        if not tensor:
            return Response(status=HTTPStatus.NOT_FOUND)

        return dataclasses.asdict(tensor)


@api.route(
    "/local/upload",
    methods=[
        "POST",
    ],
)
def create_upload_files():
    files = request.files.getlist("files")
    local_dir = current_app.config["LOCAL_DATA_DIRECTORY"]
    filenames = [Path(f.filename).name for f in files]

    logger.info(f"Received files: {filenames}")

    if "db.sqlite" not in filenames or "config.json" not in filenames:
        return StatusMessage(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            message="Invalid project directory.",
        ).model_dump()

    report_name = files[0].filename.split("/")[0]
    report_directory = Path(local_dir)
    logger.info(f"Writing report files to {report_directory}/{report_name}")
    for file in files:
        logger.info(f"Processing file: {file.filename}")
        destination_file = Path(report_directory, Path(file.filename))
        logger.info(f"Writing file to {destination_file}")
        if not destination_file.parent.exists():
            logger.info(
                f"{destination_file.parent.name} does not exist. Creating directory"
            )
            destination_file.parent.mkdir(exist_ok=True, parents=True)
        file.save(destination_file)

    # Set Active Report on View
    active_report = ActiveReport(local=True, name=report_name)
    update_tab_session({"active_report": active_report})

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
    try:
        sync_test_folders(
            RemoteConnection(**connection), RemoteFolder(**folder), remote_dir
        )
    except RemoteFolderException as e:
        return Response(status=e.status, response=e.message)
    return Response(status=HTTPStatus.OK)


@api.route("/reports/active", methods=["GET"])
def get_active_folder():
    # Used to gate UI functions if no report is active
    if hasattr(request, "tab_session_data"):
        active_report = request.tab_session_data.get("active_report", None)
        if active_report:
            return active_report
    return Response(status=HTTPStatus.NOT_FOUND)


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
    connection_directory = Path(report_data_directory, connection.name, report_folder)
    print(connection)
    current_app.logger.info(
        f"Setting active report for {request.tab_id} to {connection.host}/{connection_directory}"
    )
    if not connection_directory.exists():
        return Response(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            response=f"{connection_directory} does not exist.",
        )

    # Set Active Report on View
    active_report = ActiveReport(name=report_folder, hostname=connection.host)

    update_tab_session({"active_report": active_report})
    return Response(status=HTTPStatus.OK)
