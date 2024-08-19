from marshmallow import fields, validates

from backend.extensions import ma
from backend.models import (
    Tensor,
    OperationArgument,
    Operation,
    InputTensor,
    StackTrace,
    OutputTensor,
    Buffer,
)


# Database Schemas

class TensorSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Tensor

    shape = ma.auto_field()
    address = ma.auto_field()
    id = ma.Function(lambda obj: obj.tensor_id, dump_only=True)
    layout = ma.auto_field()
    memory_config = ma.auto_field()
    buffer_type = ma.auto_field()
    producers = ma.Function(lambda obj: obj.producers, dump_only=True)
    consumers = ma.Function(lambda obj: obj.consumers, dump_only=True)


class StackTraceSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = StackTrace

    stack_trace = ma.Function(lambda obj: obj.stack_trace or "")


class InputOutputSchema(object):
    id = ma.Function(lambda obj: obj.tensor_id)
    operation_id = ma.auto_field()
    shape = ma.Function(lambda obj: obj.tensor.shape)
    address = ma.Function(lambda obj: obj.tensor.address)
    layout = ma.Function(lambda obj: obj.tensor.layout)
    memory_config = ma.Function(lambda obj: obj.tensor.memory_config)
    device_id = ma.Function(lambda obj: obj.tensor.device_id)
    buffer_type = ma.Function(lambda obj: obj.tensor.buffer_type)
    dtype = ma.Function(lambda obj: obj.tensor.dtype)
    producers = ma.Function(lambda obj: obj.tensor.producers)
    consumers = ma.Function(lambda obj: obj.tensor.consumers)


class OutputTensorSchema(ma.SQLAlchemyAutoSchema, InputOutputSchema):
    class Meta:
        model = OutputTensor

    output_index = ma.auto_field()
    operation_id = ma.auto_field()
    tensor_id = ma.auto_field()


class InputTensorSchema(ma.SQLAlchemyAutoSchema, InputOutputSchema):
    class Meta:
        model = InputTensor

    input_index = ma.auto_field()
    operation_id = ma.auto_field()
    tensor_id = ma.auto_field()


class OperationArgumentsSchema(ma.SQLAlchemySchema):
    class Meta:
        model = OperationArgument

    operation_id = ma.auto_field()
    name = ma.auto_field()
    value = ma.auto_field()


class BufferSchema(ma.SQLAlchemyAutoSchema):
    class Meta:
        model = Buffer

    address = ma.auto_field()
    max_size_per_bank = ma.auto_field()
    buffer_type = ma.auto_field()
    device_id = ma.Function(lambda obj: obj.device.device_id)


class OperationSchema(ma.SQLAlchemySchema):
    class Meta:
        model = Operation

    operation_id = ma.auto_field()
    id = ma.Function(lambda obj: obj.operation_id)
    name = ma.auto_field()
    duration = ma.auto_field()
    buffers = ma.List(ma.Nested(BufferSchema()))
    outputs = ma.List(ma.Nested(OutputTensorSchema()))
    inputs = ma.List(ma.Nested(InputTensorSchema()))
    arguments = ma.List(ma.Nested(OperationArgumentsSchema()))
    stack_trace = ma.Method("get_stack_trace")

    def get_stack_trace(self, obj):
        if obj.stack_trace and len(obj.stack_trace):
            return next(x for x in obj.stack_trace).stack_trace
        return ""


# Filesystem Schemas
class RemoteConnectionSchema(ma.Schema):
    name = fields.Str()
    host = fields.Str(required=True, error_messages={"required": "Host is required"})
    port = fields.Int(required=True, error_messages={"required": "Port is required"})
    path = fields.Str(required=True, error_messages={"required": "Path is required"})

    @validates("path")
    def validate_path(self, path):
        # TODO Validate valid path format
        # TODO Could validate on the front end as well
        pass
