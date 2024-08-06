import http

from flask import Blueprint, Response

from backend.models import (
    Operation,
    Buffer,
    InputTensor,
    OutputTensor,
    Tensor,
    StackTrace,
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
    stack_trace = StackTrace.query.filter_by(operation_id=operation.operation_id).first()
    input_tensors = InputTensorSchema().dump(operation.input_tensors, many=True)
    output_tensors = OutputTensorSchema().dump(operation.output_tensors, many=True)
    return dict(
        operation_id=operation.operation_id,
        buffers=BufferSchema().dump(buffers, many=True),
        stack_traces=StackTraceSchema().dump(stack_trace),
        input_tensors=input_tensors,
        output_tensors=output_tensors
    )


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
