import dataclasses
import json
import logging
import shutil
import sqlite3
from http import HTTPStatus
from pathlib import Path

from ttnn_visualizer.database import create_update_database
from flask import Blueprint, Response, current_app, request

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
    db_path = get_db_path_from_request(request)
    with sqlite3.connect(db_path) as conn:
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


def get_db_path_from_request(request: None):
    report_path = current_app.config["ACTIVE_DATA_DIRECTORY"]
    db_path = current_app.config["SQLITE_DB_PATH"]
    return report_path / db_path


@api.route("/operations/<operation_id>", methods=["GET"])
def operation_detail(operation_id):
    db_path = get_db_path_from_request(request)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        operation = queries.query_operation_by_id(cursor, operation_id)

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
    operation_history_filename = "operation_history.json"
    operation_history_file = Path(
        current_app.config["ACTIVE_DATA_DIRECTORY"], operation_history_filename
    )
    if not operation_history_file.exists():
        return []
    with open(operation_history_file, "r") as file:
        return json.load(file)


@api.route("/config")
def get_config():
    config_file_name = "config.json"
    config_file = Path(current_app.config["ACTIVE_DATA_DIRECTORY"], config_file_name)
    if not config_file.exists():
        return {}
    with open(config_file, "r") as file:
        return json.load(file)


@api.route("/tensors", methods=["GET"])
def tensors_list():
    db_path = get_db_path_from_request(request)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        tensors = list(queries.query_tensors(cursor))
        producers_consumers = list(queries.query_producers_consumers(cursor))
        return serialize_tensors(tensors, producers_consumers)


@api.route("/buffer", methods=["GET"])
def buffer_detail():
    address = request.args.get("address")
    operation_id = request.args.get("operation_id")

    if not address or not operation_id:
        return Response(status=HTTPStatus.BAD_REQUEST)

    db_path = get_db_path_from_request(request)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        buffer = queries.query_next_buffer(cursor, operation_id, address)
        if buffer:
            return dataclasses.asdict(buffer)

    return Response(status=HTTPStatus.NOT_FOUND)


@api.route("/tensors/<tensor_id>", methods=["GET"])
def tensor_detail(tensor_id):
    db_path = get_db_path_from_request(request)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.cursor()
        tensor = queries.query_tensor_by_id(cursor, tensor_id)
        if tensor:
            return dataclasses.asdict(tensor)

    return Response(status=HTTPStatus.NOT_FOUND)


@api.route(
    "/local/upload",
    methods=[
        "POST",
    ],
)
def create_upload_files():
    files = request.files.getlist("files")
    report_data_directory = current_app.config["REPORT_DATA_DIRECTORY"]
    active_data_directory = current_app.config["ACTIVE_DATA_DIRECTORY"]

    filenames = [Path(f.filename).name for f in files]

    logger.info(f"Received files: {filenames}")

    if "db.sqlite" not in filenames or "config.json" not in filenames:
        return StatusMessage(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            message="Invalid project directory.",
        ).model_dump()

    report_name = files[0].filename.split("/")[0]
    report_directory = Path(report_data_directory, report_name)
    logger.info(f"Writing report files to {report_directory}")
    for file in files:
        logger.info(f"Processing file: {file.filename}")
        destination_file = Path(report_data_directory, Path(file.filename))
        logger.info(f"Writing file to {destination_file}")
        if not destination_file.parent.exists():
            logger.info(
                f"{destination_file.parent.name} does not exist. Creating directory"
            )
            destination_file.parent.mkdir(exist_ok=True, parents=True)
        file.save(destination_file)

    logger.info(
        f"Copying file tree from f{report_directory} to {active_data_directory}"
    )
    shutil.copytree(report_directory, active_data_directory, dirs_exist_ok=True)
    if current_app.config["MIGRATE_ON_COPY"]:
        create_update_database(Path(active_data_directory / "db.sqlite"))
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
    request_body = request.json
    connection = request_body.get("connection")
    folder = request_body.get("folder")
    try:
        sync_test_folders(RemoteConnection(**connection), RemoteFolder(**folder))
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
    report_data_directory = current_app.config["REPORT_DATA_DIRECTORY"]
    active_data_directory = current_app.config["ACTIVE_DATA_DIRECTORY"]
    report_folder = Path(folder.remotePath).name
    connection_directory = Path(report_data_directory, connection.name, report_folder)
    if not connection_directory.exists():
        return Response(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            response=f"{connection_directory} does not exist.",
        )

    shutil.copytree(connection_directory, active_data_directory, dirs_exist_ok=True)
    if current_app.config["MIGRATE_ON_COPY"]:
        create_update_database(Path(active_data_directory / "db.sqlite"))
    return Response(status=HTTPStatus.OK)
