import dataclasses
from collections import defaultdict
from email.policy import default


def serialize_operations(
    inputs,
    operation_arguments,
    operations,
    outputs,
    stack_traces,
    tensors,
    devices,
    producers_consumers,
    device_operations,
):
    tensors_dict = {t.tensor_id: t for t in tensors}
    device_operations_dict = {
        do.operation_id: do.captured_graph
        for do in device_operations
        if hasattr(do, "operation_id")
    }

    stack_traces_dict = {st.operation_id: st.stack_trace for st in stack_traces}

    arguments_dict = defaultdict(list)
    for argument in operation_arguments:
        arguments_dict[argument.operation_id].append(argument)

    inputs_dict, outputs_dict = serialize_inputs_outputs(
        inputs, outputs, producers_consumers, tensors_dict
    )

    results = []
    for operation in operations:

        inputs = inputs_dict[operation.operation_id]
        outputs = outputs_dict[operation.operation_id]
        arguments = [
            dataclasses.asdict(a) for a in arguments_dict[operation.operation_id]
        ]
        operation_data = dataclasses.asdict(operation)
        operation_data["id"] = operation.operation_id
        operation_device_operations = device_operations_dict.get(
            operation.operation_id, []
        )
        id = operation_data.pop("operation_id", None)

        results.append(
            {
                **operation_data,
                "id": id,
                "stack_trace": stack_traces_dict.get(operation.operation_id),
                "device_operations": operation_device_operations,
                "arguments": arguments,
                "inputs": inputs,
                "outputs": outputs,
            }
        )
    return results


def serialize_inputs_outputs(inputs, outputs, producers_consumers, tensors_dict):
    producers_consumers_dict = {pc.tensor_id: pc for pc in producers_consumers}

    def attach_producers_consumers(values):
        values_dict = defaultdict(list)
        for value in values:
            tensor = tensors_dict.get(value.tensor_id)
            tensor_dict = dataclasses.asdict(tensor)
            pc = producers_consumers_dict.get(value.tensor_id)
            value_dict = dataclasses.asdict(value)
            value_dict.pop("tensor_id", None)
            value_dict.update(
                {
                    "id": tensor_dict.pop("tensor_id"),
                    "consumers": pc.consumers if pc else [],
                    "producers": pc.producers if pc else [],
                }
            )
            values_dict[value.operation_id].append({**value_dict, **tensor_dict})
        return values_dict

    inputs_dict = attach_producers_consumers(inputs)
    outputs_dict = attach_producers_consumers(outputs)
    return inputs_dict, outputs_dict


def serialize_operation(
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
):
    tensors_dict = {t.tensor_id: t for t in tensors}

    inputs_dict, outputs_dict = serialize_inputs_outputs(
        inputs, outputs, producers_consumers, tensors_dict
    )

    buffer_list = [dataclasses.asdict(buffer) for buffer in buffers]

    l1_sizes = [d.worker_l1_size for d in devices]
    arguments_data = [dataclasses.asdict(argument) for argument in operation_arguments]
    operation_data = dataclasses.asdict(operation)
    operation_data["id"] = operation.operation_id

    inputs_data = inputs_dict.get(operation.operation_id)
    outputs_data = outputs_dict.get(operation.operation_id)
    id = operation_data.pop("operation_id", None)

    return {
        **operation_data,
        "id": id,
        "l1_sizes": l1_sizes,
        "device_operations": device_operations.captured_graph or [],
        "stack_trace": stack_trace.stack_trace if stack_trace else "",
        "buffers": buffer_list,
        "arguments": arguments_data,
        "inputs": inputs_data or [],
        "outputs": outputs_data or [],
    }


def serialize_operation_buffers(operation, operation_buffers):
    buffer_data = [dataclasses.asdict(b) for b in operation_buffers]
    for b in buffer_data:
        b.pop("operation_id")
        b.update({"size": b.pop("max_size_per_bank")})
    return {"id": operation.operation_id, "buffers": list(buffer_data)}


def serialize_operations_buffers(operations, buffers):

    buffer_dict = defaultdict(list)
    for b in buffers:
        buffer_dict[b.operation_id].append(b)

    results = []
    for operation in operations:
        operation_buffers = buffer_dict.get(operation.operation_id)
        results.append(serialize_operation_buffers(operation, operation_buffers))
    return results


def serialize_tensors(tensors, producers_consumers):
    producers_consumers_dict = {pc.tensor_id: pc for pc in producers_consumers}
    results = []

    for tensor in tensors:
        tensor_data = dataclasses.asdict(tensor)
        tensor_id = tensor_data.pop("tensor_id")
        tensor_data.update(
            {
                "id": tensor_id,
                "consumers": (
                    producers_consumers_dict[tensor_id].consumers
                    if tensor_id in producers_consumers_dict
                    else []
                ),
                "producers": (
                    producers_consumers_dict[tensor_id].producers
                    if tensor_id in producers_consumers_dict
                    else []
                ),
            }
        )
        results.append(tensor_data)

    return results
