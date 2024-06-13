# main.py
from fastapi import FastAPI, HTTPException, Path, Request
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import uvicorn
from typing import List, Optional
import sqlalchemy
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, Float, Text, select
from sqlalchemy.orm import sessionmaker

DATABASE_URL = "sqlite:///./db.sqlite"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
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

class OperationDetails(BaseModel):
    operation_id: int
    input_tensors: List[Tensor]
    output_tensors: List[Tensor]
    buffers: List[Buffer]
    buffer_pages: List[BufferPage]

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
async def get_operation_details(operation_id: int = Path(..., description="The ID of the operation")):
    db = SessionLocal()



    # Fetch input tensors
    input_query = select(input_tensors).where(input_tensors.c.operation_id == operation_id)
    input_results = db.execute(input_query).mappings().all()

    input_tensor_ids = [result['tensor_id'] for result in input_results]
    input_tensors_query = select(tensors).where(tensors.c.tensor_id.in_(input_tensor_ids))
    input_tensors_data = db.execute(input_tensors_query).mappings().all()

    input_tensors_list = [Tensor(**row) for row in input_tensors_data]

    # Fetch output tensors
    output_query = select(output_tensors).where(output_tensors.c.operation_id == operation_id)
    output_results = db.execute(output_query).mappings().all()

    output_tensor_ids = [result['tensor_id'] for result in output_results]
    output_tensors_query = select(tensors).where(tensors.c.tensor_id.in_(output_tensor_ids))
    output_tensors_data = db.execute(output_tensors_query).mappings().all()

    output_tensors_list = [Tensor(**row) for row in output_tensors_data]

    # Fetch buffers
    buffers_query = select(buffers).where(buffers.c.operation_id == operation_id)
    buffers_data = db.execute(buffers_query).mappings().all()

    buffers_list = [Buffer(**row) for row in buffers_data]

    # Fetch buffer pages
    buffer_pages_query = select(buffer_pages).where(buffer_pages.c.operation_id == operation_id)
    buffer_pages_data = db.execute(buffer_pages_query).mappings().all()

    buffer_pages_list = [BufferPage(**row) for row in buffer_pages_data]

    return OperationDetails(
        operation_id=operation_id,
        input_tensors=input_tensors_list,
        output_tensors=output_tensors_list,
        buffers=buffers_list,
        buffer_pages=buffer_pages_list
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
