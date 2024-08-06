import http
import json
from pathlib import Path
import shutil

from flask import Blueprint, Response, current_app, request

from backend.models import (
    Operation,
    Buffer,
    InputTensor,
    OutputTensor,
    Tensor,
    StackTrace,
)
from backend.remotes import RemoteFolderException, StatusMessage, check_remote_path, get_remote_test_folders, sync_test_folders
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
    return Response(status=200)


@api.route("/operations", methods=["GET"])
def operation_list():
    operations = Operation.query.all()
    return OperationSchema(
        many=True, exclude=["buffers", "input_tensors", "output_tensors"]
    ).dump(operations)


@api.route("/operations/<operation_id>", methods=["GET"])
def operation_detail(operation_id):
    operation = Operation.query.get(operation_id)
    if not operation:
        return Response(status=http.HTTPStatus.NOT_FOUND)

    buffers = Buffer.query.filter_by(operation_id=operation.operation_id).all()
    stack_trace = StackTrace.query.filter_by(
        operation_id=operation.operation_id
    ).first()
    input_tensors = InputTensorSchema().dump(operation.input_tensors, many=True)
    output_tensors = OutputTensorSchema().dump(operation.output_tensors, many=True)
    return dict(
        operation_id=operation.operation_id,
        buffers=BufferSchema().dump(buffers, many=True),
        stack_traces=StackTraceSchema().dump(stack_trace),
        input_tensors=input_tensors,
        output_tensors=output_tensors,
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
        return Response(status=http.HTTPStatus.NOT_FOUND)
    response = dict()
    response.update(get_producer_consumers(tensor))
    response.update({"tensor": TensorSchema().dump(tensor)})
    return response


def get_producer_consumers(t: Tensor):
    consumers = [
        c.operation_id for c in InputTensor.query.filter_by(tensor_id=t.tensor_id)
    ]
    producers = [
        c.operation_id for c in OutputTensor.query.filter_by(tensor_id=t.tensor_id)
    ]
    return dict(consumers=consumers, producers=producers)



@api.route("/local/upload", methods=["POST",])
def create_upload_files():
    """
    Copies the folder upload into the active data directory
    :param files:
    :return:
    """
    files = request.files.getlist("files") 
    for f in files:
        print(f)
    REPORT_DATA_DIRECTORY = current_app.config["REPORT_DATA_DIRECTORY"]
    ACTIVE_DATA_DIRECTORY = current_app.config["ACTIVE_DATA_DIRECTORY"]
    current_app.config["UPLOAD_FOLDER"] = REPORT_DATA_DIRECTORY

    filenames = [Path(f.filename).name for f in files]
    print(filenames)
    if "db.sqlite" not in filenames or "config.json" not in filenames:
        return StatusMessage(status=500, message="Invalid project directory.").dict()

    # Grab a file path to get the top level path
    file_path = Path(Path(files[0].filename))
    top_level_directory = file_path.parents[0].name
    destination_dir = Path(REPORT_DATA_DIRECTORY, top_level_directory)
    for file in files:
        destination_file = Path(
            REPORT_DATA_DIRECTORY, Path(file.filename)
        )
        destination_file.parent.mkdir(exist_ok=True, parents=True)
        file.save(Path(current_app.config["UPLOAD_FOLDER"], file.filename))

    shutil.copytree(destination_dir, ACTIVE_DATA_DIRECTORY, dirs_exist_ok=True)
    return StatusMessage(status=200, message="Success.").dict()



@api.route("/remote/folder", methods=["POST"])
async def get_remote_folders():
    connection = request.json 
    try:
        return get_remote_test_folders(connection)
    except RemoteFolderException as e:
        return Response(status_code=e.status, content=e.message)


@api.route("/remote/test", methods=["POST"])
async def test_remote_folder():
    connection = json.loads(request.json)
    try:
        check_remote_path(connection)
    except RemoteFolderException as e:
        return Response(status_code=e.status, content=e.message)
    return Response(status_code=200)


@api.route("/remote/sync", methods=["POST"])
async def sync_remote_folder():
    request_body = json.loads(request.json)
    connection = request_body.get("connection")
    folder = request_body.get("folder")
    try:
        sync_test_folders(connection, folder)
    except RemoteFolderException as e:
        return Response(status_code=e.status, content=e.message)
    return Response(status_code=200, content="")


@api.route("/remote/use", methods=["POST"]) 
async def use_remote_folder():
    REPORT_DATA_DIRECTORY = current_app.config["REPORT_DATA_DIRECTORY"]
    ACTIVE_DATA_DIRECTORY = current_app.config["ACTIVE_DATA_DIRECTORY"]
    request_body = json.loads(request.json)
    connection = request_body.get("connection")
    folder = request_body.get("folder")
    report_folder = Path(folder.remotePath).name
    connection_directory = Path(
        REPORT_DATA_DIRECTORY, connection.name, report_folder
    )
    shutil.copytree(connection_directory, ACTIVE_DATA_DIRECTORY, dirs_exist_ok=True)
    return Response(status_code=200)