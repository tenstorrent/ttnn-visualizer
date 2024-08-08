import json
import shutil
from http import HTTPStatus
from pathlib import Path

from flask import Blueprint, Response, current_app, request

from backend.models import (
    Device,
    Operation,
    Buffer,
    Tensor,
    StackTrace,
)
from backend.remotes import (
    RemoteConnection,
    RemoteFolder,
    RemoteFolderException,
    StatusMessage,
    check_remote_path,
    get_remote_test_folders,
    sync_test_folders,
)
from backend.schemas import (
    OperationSchema,
    BufferSchema,
    InputTensorSchema,
    OutputTensorSchema,
    TensorSchema,
    StackTraceSchema,
)

api = Blueprint("api", __name__, url_prefix="/api")


@api.route("/up", methods=["GET", "POST"])
def health_check():
    return Response(status=HTTPStatus.OK)


@api.route("/operations", methods=["GET"])
def operation_list():
    operations = Operation.query.all()
    return OperationSchema(
        many=True,
        exclude=[
            "buffers",
            "operation_id",
        ],
    ).dump(operations)


@api.route("/operations/<operation_id>", methods=["GET"])
def operation_detail(operation_id):
    operation = Operation.query.get(operation_id)
    if not operation:
        return Response(status=HTTPStatus.NOT_FOUND)
    devices = Device.query.order_by(Device.device_id.asc()).all()
    l1_sizes = [d.worker_l1_size for d in devices]

    return dict(
        **OperationSchema().dump(operation),
        l1_sizes=l1_sizes,
    )


@api.route(
    "operation-history",
    methods=[
        "GET",
    ],
)
def get_operation_history():
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
def get_tensors():
    tensors = Tensor.query.all()
    return TensorSchema().dump(tensors, many=True)


@api.route("/tensors/<tensor_id>", methods=["GET"])
def get_tensor(tensor_id):
    tensor = Tensor.query.get(tensor_id)
    if not tensor:
        return Response(status=HTTPStatus.NOT_FOUND)
    return TensorSchema().dump(tensor)


@api.route(
    "/local/upload",
    methods=[
        "POST",
    ],
)
def create_upload_files():
    """
    Copies the folder upload into the active data directory
    :return:
    """
    files = request.files.getlist("files")
    for f in files:
        print(f)
    REPORT_DATA_DIRECTORY = current_app.config["REPORT_DATA_DIRECTORY"]
    ACTIVE_DATA_DIRECTORY = current_app.config["ACTIVE_DATA_DIRECTORY"]

    filenames = [Path(f.filename).name for f in files]
    print(filenames)
    if "db.sqlite" not in filenames or "config.json" not in filenames:
        return StatusMessage(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            message="Invalid project directory.",
        ).dict()

    # Grab a file path to get the top level path
    file_path = Path(Path(files[0].filename))
    top_level_directory = file_path.parents[0].name
    destination_dir = Path(REPORT_DATA_DIRECTORY, top_level_directory)
    destination_dir.mkdir(exist_ok=True, parents=True)
    for file in files:
        destination_file = Path(REPORT_DATA_DIRECTORY, Path(file.filename))
        if not destination_file.parent.exists():
            destination_file.parent.mkdir(exist_ok=True, parents=True)
        file.save(destination_file)

    shutil.copytree(destination_dir, ACTIVE_DATA_DIRECTORY, dirs_exist_ok=True)
    return StatusMessage(status=HTTPStatus.OK, message="Success.").dict()


@api.route("/remote/folder", methods=["POST"])
def get_remote_folders():
    connection = request.json
    try:
        remote_folders = get_remote_test_folders(RemoteConnection(**connection))
        return [r.dict() for r in remote_folders]
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
    REPORT_DATA_DIRECTORY = current_app.config["REPORT_DATA_DIRECTORY"]
    ACTIVE_DATA_DIRECTORY = current_app.config["ACTIVE_DATA_DIRECTORY"]
    report_folder = Path(folder.remotePath).name
    connection_directory = Path(REPORT_DATA_DIRECTORY, connection.name, report_folder)
    if not connection_directory.exists():
        return Response(
            status=HTTPStatus.INTERNAL_SERVER_ERROR,
            response=f"{connection_directory} does not exist.",
        )
    shutil.copytree(connection_directory, ACTIVE_DATA_DIRECTORY, dirs_exist_ok=True)
    return Response(status=HTTPStatus.OK)
