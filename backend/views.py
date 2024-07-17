import http

from flask import Blueprint, Response

from backend.models import Operation, Buffer, InputTensor, OutputTensor, Tensor, StackTrace
from backend.schemas import OperationSchema, BufferSchema, InputTensorSchema, OutputTensorSchema, TensorSchema, \
    StackTraceSchema

api = Blueprint("api", __name__, url_prefix="/api")


@api.route("/up", methods=["GET", "POST"])
def health_check():
    return Response(status=200)


@api.route("/operations", methods=["GET"])
def operation_list():
    operations = Operation.query.all()
    return OperationSchema(many=True).dump(operations)


@api.route("/operations/<operation_id>", methods=["GET"])
def operation_detail(operation_id):
    operation = Operation.query.get(operation_id)
    buffers = Buffer.query.filter_by(operation_id=operation.operation_id).all()
    input_output_tensors = get_input_output_tensors(operation)
    stack_trace = StackTrace.query.filter_by(operation_id=operation.operation_id).all()

    if not operation:
        return Response(status=http.HTTPStatus.NOT_FOUND)

    return dict(
        operation_id=operation.operation_id,
        buffers=BufferSchema().dump(buffers, many=True),
        stack_traces=StackTraceSchema().dump(stack_trace, many=True),
        input_tensors=input_output_tensors.get('input_tensors', []),
        output_tensors=input_output_tensors.get('output_tensors', []),
    )


@api.route("/tensors", methods=["GET"])
def get_tensors():
    tensors = map(attach_producer_consumers, Tensor.query.all())
    return TensorSchema().dump(tensors, many=True)


@api.route("/tensors/<tensor_id>", methods=["GET"])
def get_tensor(tensor_id):
    tensor = Tensor.query.get(tensor_id)
    if not tensor:
        return Response(status=http.HTTPStatus.NOT_FOUND)
    return TensorSchema().dump(attach_producer_consumers(tensor))


def attach_producer_consumers(t: Tensor):
    t.consumers = [c.operation_id for c in InputTensor.query.filter_by(tensor_id=t.tensor_id)]
    t.producers = [c.operation_id for c in OutputTensor.query.filter_by(tensor_id=t.tensor_id)]
    return t


def get_input_output_tensors(operation: Operation):
    input_tensors = InputTensorSchema().dump(map(attach_producer_consumers, operation.input_tensors), many=True)
    output_tensors = OutputTensorSchema().dump(map(attach_producer_consumers, operation.output_tensors), many=True)
    return dict(input_tensors=input_tensors, output_tensors=output_tensors)
