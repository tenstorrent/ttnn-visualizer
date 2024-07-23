import shutil
from pathlib import Path as PathlibPath
from typing import List, Optional

import httpx
import uvicorn
from fastapi import FastAPI, Path, Request, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, Float, Text, select
from sqlalchemy.orm import sessionmaker

from backend.remotes import RemoteConnection, check_remote_path, StatusMessage, RemoteFolder, get_remote_test_folders, \
    sync_test_folders, REPORT_DATA_DIRECTORY, ACTIVE_DATA_DIRECTORY

DATABASE_URL = f"sqlite:////{ACTIVE_DATA_DIRECTORY}/db.sqlite"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    pool_size=10,
    max_overflow=20,
    pool_timeout=60,
    pool_recycle=1800,
)
metadata = MetaData()

app = FastAPI()


@app.middleware("http")
async def add_cache_control_header(request, call_next):
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    return response


origins = [
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Operation(BaseModel):
    id: int
    name: str
    duration: float
    description: Optional[str] = None


class OperationWithArguments(BaseModel):
    id: int
    name: str
    duration: float
    arguments: List[dict]


class Tensor(BaseModel):
    tensor_id: int
    shape: Optional[str]
    dtype: Optional[str]
    layout: Optional[str]
    memory_config: Optional[str]
    device_id: Optional[int]
    address: Optional[int]
    buffer_type: Optional[int]
    producers: List[int]
    consumers: List[int]


class Buffer(BaseModel):
    operation_id: int
    device_id: int
    address: int
    max_size_per_bank: int
    buffer_type: int


class BufferPage(BaseModel):
    operation_id: int
    device_id: int
    address: int
    core_y: int
    core_x: int
    bank_id: int
    page_index: int
    page_address: int
    page_size: int
    buffer_type: int


class Device(BaseModel):
    device_id: int
    worker_l1_size: int


class GraphData(BaseModel):
    l1_size: int
    buffers: List[Buffer]
    buffer_pages: List[BufferPage]


class StackTrace(BaseModel):
    operation_id: int
    stack_trace: str


class OperationDetails(BaseModel):
    operation_id: int
    input_tensors: List[Tensor]
    output_tensors: List[Tensor]
    buffers: List[Buffer]
    l1_sizes: List[int]
    # buffer_pages: List[BufferPage]
    stack_trace: str


class GlyphData(BaseModel):
    glyph_y_location: List[int]
    glyph_x_location: List[int]
    glyph_height: List[int]
    glyph_width: List[int]
    color: List[str]
    line_color: List[str]
    address: List[int]
    max_size_per_bank: List[int]


class PlotData(BaseModel):
    l1_size: int
    memory_data: GlyphData
    buffer_data: GlyphData


class TensorDetails(BaseModel):
    tensor_id: int
    shape: Optional[str]
    dtype: Optional[str]
    layout: Optional[str]
    memory_config: Optional[str]
    device_id: Optional[int]
    address: Optional[int]
    buffer_type: Optional[int]


class TensorDetailsResponse(BaseModel):
    tensor: TensorDetails
    producers: List[int]
    consumers: List[int]


operations = Table(
    "operations",
    metadata,
    Column("operation_id", Integer, primary_key=True),
    Column("name", String),
    Column("duration", Float),
)

operation_arguments = Table(
    "operation_arguments",
    metadata,
    Column("operation_id", Integer),
    Column("name", Text),
    Column("value", Text),
)

input_tensors = Table(
    "input_tensors",
    metadata,
    Column("operation_id", Integer),
    Column("input_index", Integer),
    Column("tensor_id", Integer),
)

tensors = Table(
    "tensors",
    metadata,
    Column("tensor_id", Integer, primary_key=True),
    Column("shape", Text),
    Column("dtype", Text),
    Column("layout", Text),
    Column("memory_config", Text),
    Column("device_id", Integer),
    Column("address", Integer),
    Column("buffer_type", Integer),
)

output_tensors = Table(
    "output_tensors",
    metadata,
    Column("operation_id", Integer),
    Column("output_index", Integer),
    Column("tensor_id", Integer),
)

buffers = Table(
    "buffers",
    metadata,
    Column("operation_id", Integer),
    Column("device_id", Integer),
    Column("address", Integer),
    Column("max_size_per_bank", Integer),
    Column("buffer_type", Integer),
)

buffer_pages = Table(
    "buffer_pages",
    metadata,
    Column("operation_id", Integer),
    Column("device_id", Integer),
    Column("address", Integer),
    Column("core_y", Integer),
    Column("core_x", Integer),
    Column("bank_id", Integer),
    Column("page_index", Integer),
    Column("page_address", Integer),
    Column("page_size", Integer),
    Column("buffer_type", Integer),
)

devices = Table(
    "devices",
    metadata,
    Column("device_id", Integer, primary_key=True),
    Column("num_y_cores", Integer),
    Column("num_x_cores", Integer),
    Column("num_y_compute_cores", Integer),
    Column("num_x_compute_cores", Integer),
    Column("worker_l1_size", Integer),
    Column("l1_num_banks", Integer),
    Column("l1_bank_size", Integer),
    Column("address_at_first_l1_bank", Integer),
    Column("address_at_first_l1_cb_buffer", Integer),
    Column("num_banks_per_storage_core", Integer),
    Column("num_compute_cores", Integer),
    Column("num_storage_cores", Integer),
    Column("total_l1_memory", Integer),
    Column("total_l1_for_tensors", Integer),
    Column("total_l1_for_interleaved_buffers", Integer),
    Column("total_l1_for_sharded_buffers", Integer),
    Column("cb_limit", Integer),
)

stack_traces = Table(
    "stack_traces",
    metadata,
    Column("operation_id", Integer, primary_key=True),
    Column("stack_trace", Text)
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@app.on_event("startup")
def startup():
    metadata.create_all(bind=engine)


@app.on_event("shutdown")
def shutdown():
    engine.dispose()


@app.get("/api")
async def read_root():
    return {"message": "Hello from FastAPI"}


@app.post("/api/local/upload")
async def create_upload_files(
    files: List[UploadFile] = File(...)
):
    """
    Copies the folder upload into the active data directory
    :param files:
    :return:
    """

    filenames = [PathlibPath(f.filename).name for f in files]
    if 'db.sqlite' not in filenames or 'config.json' not in filenames:
        return StatusMessage(status=500, message="Invalid project directory.")

    # Grab a file path to get the top level path
    file_path = PathlibPath(PathlibPath(files[0].filename))
    top_level_directory = file_path.parents[0].name
    destination_dir = PathlibPath(REPORT_DATA_DIRECTORY, top_level_directory)
    for file in files:
        destination_file = PathlibPath(REPORT_DATA_DIRECTORY, PathlibPath(file.filename))
        destination_file.parent.mkdir(exist_ok=True, parents=True)
        with open(destination_file, 'wb') as f:
            shutil.copyfileobj(file.file, f)

    shutil.copytree(destination_dir, ACTIVE_DATA_DIRECTORY, dirs_exist_ok=True)
    return StatusMessage(status=200, message="success")


@app.post("/api/remote/folder", response_model=List[RemoteFolder])
async def get_remote_folders(connection: RemoteConnection):
    return get_remote_test_folders(connection)


@app.post("/api/remote/test", response_model=StatusMessage)
async def get_remote_folders(connection: RemoteConnection):
    return check_remote_path(connection)


@app.post("/api/remote/sync", response_model=StatusMessage)
async def sync_remote_folder(connection: RemoteConnection, folder: RemoteFolder):
    sync_test_folders(connection, folder)
    return StatusMessage(status=200, message="success")


@app.post("/api/remote/use", response_model=StatusMessage)
async def use_remote_folder(connection: RemoteConnection, folder: RemoteFolder):
    report_folder = PathlibPath(folder.remotePath).name
    connection_directory = PathlibPath(REPORT_DATA_DIRECTORY, connection.name, report_folder)
    shutil.copytree(connection_directory, ACTIVE_DATA_DIRECTORY, dirs_exist_ok=True)
    return StatusMessage(status=200, message="success")


@app.get("/api/get-operations", response_model=List[OperationWithArguments])
async def get_operations():
    db = SessionLocal()
    operations_query = select(operations)
    operations_list = db.execute(operations_query).fetchall()

    operations_dict = {operation.operation_id: {
        "id": operation.operation_id,
        "name": operation.name,
        "duration": operation.duration,
        "arguments": []
    } for operation in operations_list}

    arguments_query = select(operation_arguments)
    arguments_list = db.execute(arguments_query).fetchall()

    for argument in arguments_list:
        if not any(arg["name"] == argument.name for arg in operations_dict[argument.operation_id]["arguments"]):
            operations_dict[argument.operation_id]["arguments"].append({
                "name": argument.name,
                "value": argument.value
            })

    return list(operations_dict.values())


@app.get("/api/get-operation-details/{operation_id}", response_model=OperationDetails)
async def get_operation_details(operation_id: int = Path(..., description="")):
    db = SessionLocal()

    # Fetch input tensors
    input_query = select(input_tensors).where(input_tensors.c.operation_id == operation_id)
    input_results = db.execute(input_query).mappings().all()

    input_tensor_ids = [result['tensor_id'] for result in input_results]
    input_tensors_query = select(tensors).where(tensors.c.tensor_id.in_(input_tensor_ids))
    input_tensors_data = db.execute(input_tensors_query).mappings().all()

    # Add producers and consumers to input tensors
    input_tensors_list = []
    for row in input_tensors_data:
        tensor_id = row['tensor_id']

        # Fetch producers
        producers_query = select(output_tensors.c.operation_id).where(output_tensors.c.tensor_id == tensor_id)
        producers_results = db.execute(producers_query).fetchall()
        producers_list = [result[0] for result in producers_results]

        # Fetch consumers
        consumers_query = select(input_tensors.c.operation_id).where(input_tensors.c.tensor_id == tensor_id)
        consumers_results = db.execute(consumers_query).fetchall()
        consumers_list = [result[0] for result in consumers_results]

        tensor = Tensor(
            tensor_id=row['tensor_id'],
            shape=row['shape'],
            dtype=row['dtype'],
            layout=row['layout'],
            memory_config=row['memory_config'],
            device_id=row['device_id'],
            address=row['address'],
            buffer_type=row['buffer_type'],
            producers=producers_list,
            consumers=consumers_list
        )
        input_tensors_list.append(tensor)

    # Fetch output tensors
    output_query = select(output_tensors).where(output_tensors.c.operation_id == operation_id)
    output_results = db.execute(output_query).mappings().all()

    output_tensor_ids = [result['tensor_id'] for result in output_results]
    output_tensors_query = select(tensors).where(tensors.c.tensor_id.in_(output_tensor_ids))
    output_tensors_data = db.execute(output_tensors_query).mappings().all()

    # Add producers and consumers to output tensors
    output_tensors_list = []
    for row in output_tensors_data:
        tensor_id = row['tensor_id']

        # Fetch producers
        producers_query = select(output_tensors.c.operation_id).where(output_tensors.c.tensor_id == tensor_id)
        producers_results = db.execute(producers_query).fetchall()
        producers_list = [result[0] for result in producers_results]

        # Fetch consumers
        consumers_query = select(input_tensors.c.operation_id).where(input_tensors.c.tensor_id == tensor_id)
        consumers_results = db.execute(consumers_query).fetchall()
        consumers_list = [result[0] for result in consumers_results]

        tensor = Tensor(
            tensor_id=row['tensor_id'],
            shape=row['shape'],
            dtype=row['dtype'],
            layout=row['layout'],
            memory_config=row['memory_config'],
            device_id=row['device_id'],
            address=row['address'],
            buffer_type=row['buffer_type'],
            producers=producers_list,
            consumers=consumers_list
        )
        output_tensors_list.append(tensor)

    # Fetch buffers
    buffers_query = select(buffers).where(buffers.c.operation_id == operation_id)
    buffers_data = db.execute(buffers_query).mappings().all()

    unique_addresses = set()
    buffers_list = []

    for row in buffers_data:
        buffer = Buffer(**row)
        if buffer.address not in unique_addresses:
            unique_addresses.add(buffer.address)
            buffers_list.append(buffer)

    device_query = select(devices)
    device_data = db.execute(device_query).mappings().all()
    l1_sizes = [None] * (max(device['device_id'] for device in device_data) + 1)
    for device in device_data:
        l1_sizes[device['device_id']] = device['worker_l1_size']

        # Fetch stack trace
        stack_trace_query = select(stack_traces).where(stack_traces.c.operation_id == operation_id)
        stack_trace_result = db.execute(stack_trace_query).mappings().first()
        stack_trace = stack_trace_result['stack_trace'] if stack_trace_result else ""

    return OperationDetails(
        operation_id=operation_id,
        input_tensors=input_tensors_list,
        output_tensors=output_tensors_list,
        buffers=buffers_list,
        l1_sizes=l1_sizes,
        stack_trace=stack_trace
    )


@app.get("/api/get-tensor-details/{tensor_id}", response_model=TensorDetailsResponse)
async def get_tensor_details(tensor_id: int = Path(..., description="The ID of the tensor")):
    db = SessionLocal()

    # Fetch tensor details
    tensor_query = select(tensors).where(tensors.c.tensor_id == tensor_id)
    tensor_result = db.execute(tensor_query).first()

    if not tensor_result:
        raise HTTPException(status_code=404, detail="Tensor not found")

    tensor_details = TensorDetails(
        tensor_id=tensor_result[0],
        shape=tensor_result[1],
        dtype=tensor_result[2],
        layout=tensor_result[3],
        memory_config=tensor_result[4],
        device_id=tensor_result[5],
        address=tensor_result[6],
        buffer_type=tensor_result[7]
    )

    # Fetch producers
    producers_query = select(output_tensors.c.operation_id).where(output_tensors.c.tensor_id == tensor_id)
    producers_results = db.execute(producers_query).fetchall()
    producers_list = [result[0] for result in producers_results]

    # Fetch consumers
    consumers_query = select(input_tensors.c.operation_id).where(input_tensors.c.tensor_id == tensor_id)
    consumers_results = db.execute(consumers_query).fetchall()
    consumers_list = [result[0] for result in consumers_results]

    return TensorDetailsResponse(
        tensor=tensor_details,
        producers=producers_list,
        consumers=consumers_list
    )


# Middleware to proxy requests to Vite development server, excluding /api/* requests
@app.middleware("http")
async def proxy_middleware(request: Request, call_next):
    if request.url.path.startswith("/api"):
        response = await call_next(request)
        return response

    vite_url = f"http://localhost:5173{request.url.path}"
    async with httpx.AsyncClient() as client:
        try:
            vite_response = await client.request(
                method=request.method,
                url=vite_url,
                content=await request.body(),
                headers=request.headers,
                params=request.query_params,
            )
            headers = {k: v for k, v in vite_response.headers.items() if k.lower() != 'content-encoding'}
            return StreamingResponse(vite_response.aiter_bytes(), headers=headers)
        except httpx.RequestError as exc:
            return JSONResponse(status_code=500, content={"message": f"Error connecting to Vite server: {exc}"})


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
