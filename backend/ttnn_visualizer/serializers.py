import dataclasses
from collections import defaultdict


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
    tensors_dict = dict()
    for t in tensors:
        tensors_dict.update({t.tensor_id: t})

    device_operations_dict = dict()
    for device_operation in device_operations:
        device_operations_dict.update(
            {device_operation.operation_id: device_operation.captured_graph}
        )

    stack_traces_dict = defaultdict(str)
    for stack_trace in stack_traces:
        stack_traces_dict.update({stack_trace.operation_id: stack_trace.stack_trace})

    # Join Arguments
    arguments_dict = defaultdict(list)
    for argument in operation_arguments:
        arguments_dict[argument.operation_id].append(argument)

    inputs_dict, outputs_dict = serialize_inputs_outputs(
        inputs, outputs, producers_consumers, tensors_dict
    )

    # Serialize Final Results
    results = []
    for operation in operations:
        inputs = inputs_dict[operation.operation_id]
        outputs = outputs_dict[operation.operation_id]
        arguments = [
            dataclasses.asdict(a) for a in arguments_dict[operation.operation_id]
        ]
        operation_data = dataclasses.asdict(operation)
        operation_data.update({"id": operation.operation_id})
        operation_device_operations = device_operations_dict.get(
            operation.operation_id, []
        )

        results.append(
            dict(
                **operation_data,
                stack_trace=stack_traces_dict.get(operation.operation_id),
                device_operations=operation_device_operations,
                arguments=arguments,
                inputs=inputs,
                outputs=outputs,
            )
        )
    return results


def serialize_inputs_outputs(inputs, outputs, producers_consumers, tensors_dict):

    producers_consumers_dict = dict()
    for pc in producers_consumers:
        producers_consumers_dict.update({pc.tensor_id: pc})

    def attach_producers_consumers(producers_consumers_dict, values):
        values_dict = defaultdict(list)
        for value in values:
            value_dict = dataclasses.asdict(value)
            tensor = tensors_dict.get(value.tensor_id)
            tensor_dict = dataclasses.asdict(tensor)
            producers_consumers = producers_consumers_dict.get(value.tensor_id)
            value_dict.update(
                {
                    "id": tensor_dict.pop("tensor_id"),
                    "consumers": producers_consumers.consumers,
                    "producers": producers_consumers.producers,
                }
            )
            values_dict[value.operation_id].append(dict(**value_dict, **tensor_dict))
        return values_dict

    inputs_dict = attach_producers_consumers(producers_consumers_dict, inputs)
    outputs_dict = attach_producers_consumers(producers_consumers_dict, outputs)
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

    tensors_dict = dict()
    for t in tensors:
        tensors_dict.update({t.tensor_id: t})

    producers_consumers_dict = dict()
    for pc in producers_consumers:
        producers_consumers_dict.update({pc.tensor_id: pc})

    inputs_dict, outputs_dict = serialize_inputs_outputs(
        inputs, outputs, producers_consumers, tensors_dict
    )

    # Serialize Buffers
    buffer_list = []
    for buffer in buffers:
        buffer_data = dataclasses.asdict(buffer)
        buffer_list.append(buffer_data)

    l1_sizes = [d.worker_l1_size for d in devices]
    arguments_data = [dataclasses.asdict(argument) for argument in operation_arguments]
    operation_data = operation.__dict__.copy()
    operation_data.update({"id": operation.operation_id})

    inputs_data = inputs_dict.get(operation.operation_id)
    if len(inputs_data):
        inputs_data = inputs_data[0]

    outputs_data = outputs_dict.get(operation.operation_id)
    if len(outputs_data):
        outputs_data = outputs_data[0]

    return dict(
        **operation_data,
        l1_sizes=l1_sizes,
        device_operations=device_operations.captured_graph if device_operations else [],
        stack_trace=stack_trace or "",
        buffers=buffer_list,
        arguments=arguments_data,
        inputs=inputs_data or [],
        outputs=outputs_data or [],
    )


def serialize_tensors(tensors, producers_consumers):
    producers_consumers_dict = dict()
    for pc in producers_consumers:
        producers_consumers_dict.update({pc.tensor_id: pc})
    results = []
    for tensor in tensors:
        tensor_data = dataclasses.asdict(tensor)
        tensor_id = tensor_data.pop("tensor_id")
        tensor_data.update(
            {
                "id": tensor_id,
                "consumers": producers_consumers_dict[tensor_id].consumers,
                "producers": producers_consumers_dict[tensor_id].producers,
            }
        )

        results.append(tensor_data)
    return results
