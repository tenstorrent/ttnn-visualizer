from fastapi import FastAPI, Request, Query
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import httpx
import uvicorn
from typing import List
import sqlalchemy
from sqlalchemy import create_engine, MetaData, Table, Column, Integer, String, Float, select
from sqlalchemy.orm import sessionmaker
import os

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
    description: str

class OperationWithArguments(BaseModel):
    id: int
    name: str
    duration: float
    arguments: List[dict]

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
    Column("name", String),
    Column("value", String),
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
    operations_query = select(operations)  # Corrected line
    operations_list = db.execute(operations_query).fetchall()

    operations_dict = {operation.operation_id: {
        "id": operation.operation_id,
        "name": operation.name,
        "duration": operation.duration,
        "arguments": []
    } for operation in operations_list}

    arguments_query = select(operation_arguments)  # Corrected line
    arguments_list = db.execute(arguments_query).fetchall()

    for argument in arguments_list:
        operations_dict[argument.operation_id]["arguments"].append({
            "name": argument.name,
            "value": argument.value
        })

    return list(operations_dict.values())

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
