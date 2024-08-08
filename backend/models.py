from sqlalchemy import (
    Column,
    PrimaryKeyConstraint,
    Table,
    Integer,
    String,
    Text,
    Float,
)

from backend.extensions import db

operations = Table(
    "operations",
    db.metadata,
    Column("operation_id", Integer, primary_key=True),
    Column("name", String),
    Column("duration", Float),
)

# TODO Ask about PK for this table (UUID for instance)
operation_arguments = Table(
    "operation_arguments",
    db.metadata,
    Column("operation_id", db.ForeignKey("operations.operation_id")),
    Column("name", Text),
    Column("value", Text),
    PrimaryKeyConstraint("operation_id", "value", "name"),
)

# TODO Ask about PK for this table (UUID for instance)
input_tensors = Table(
    "input_tensors",
    db.metadata,
    Column("operation_id", db.ForeignKey("operations.operation_id")),
    Column("input_index", Integer),
    Column("tensor_id", db.ForeignKey("tensors.tensor_id")),
    PrimaryKeyConstraint("operation_id", "input_index", "tensor_id"),
)

tensors = Table(
    "tensors",
    db.metadata,
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
    db.metadata,
    Column("operation_id", db.ForeignKey("operations.operation_id")),
    Column("output_index", Integer),
    Column("tensor_id", db.ForeignKey("tensors.tensor_id")),
    PrimaryKeyConstraint("operation_id", "output_index", "tensor_id"),
)

stack_traces = Table(
    "stack_traces",
    db.metadata,
    Column("operation_id", db.ForeignKey("operations.operation_id")),
    Column("stack_trace", Text),
    PrimaryKeyConstraint("operation_id", "stack_trace")
)

buffers = Table(
    "buffers",
    db.metadata,
    Column("operation_id", db.ForeignKey("operations.operation_id")),
    Column("device_id", db.ForeignKey("devices.device_id")),
    Column("address", Integer),
    Column("max_size_per_bank", Integer),
    Column("buffer_type", Integer),
    PrimaryKeyConstraint("operation_id", "device_id", "address", "max_size_per_bank"),
)

devices = Table(
    "devices",
    db.metadata,
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


class Device(db.Model):
    __table__ = devices


class Tensor(db.Model):
    __table__ = tensors

    def producers(self):
        return [c.operation_id for c in OutputTensor.query.filter_by(tensor_id=self.tensor_id)]

    def consumers(self):
        return [c.operation_id for c in InputTensor.query.filter_by(tensor_id=self.tensor_id)]


class Buffer(db.Model):
    __table__ = buffers
    device = db.relationship("Device")


class InputTensor(db.Model):
    __table__ = input_tensors
    tensor = db.relationship("Tensor", backref="input")


class StackTrace(db.Model):
    __table__ = stack_traces


class OutputTensor(db.Model):
    __table__ = output_tensors
    tensor = db.relationship("Tensor", backref="output")



class Operation(db.Model):
    __table__ = operations
    arguments = db.relationship("OperationArgument", backref="operation")
    inputs = db.relationship("InputTensor", backref="operation")
    outputs = db.relationship("OutputTensor", backref="operation")
    buffers = db.relationship("Buffer", backref="operation")



class OperationArgument(db.Model):
    __table__ = operation_arguments
