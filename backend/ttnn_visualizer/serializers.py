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
                stack_trace=stack_traces_dict.get(operation.operation_id),
                **operation_data,
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
    # Serialize Inputs
    inputs_dict = defaultdict(list)
    for input in inputs:
        input_tensor = dataclasses.asdict(tensors_dict[input.tensor_id])
        producers_consumers = producers_consumers_dict.get(input.tensor_id)

        input_tensor.update(
            {
                "id": input_tensor.pop("tensor_id"),
                "consumers": producers_consumers.consumers,
                "producers": producers_consumers.producers,
            }
        )

        input_data = dataclasses.asdict(input)
        inputs_dict[input.operation_id].append(dict(**input_data, **input_tensor))
    # Serialize Outputs
    outputs_dict = defaultdict(list)
    for output in outputs:
        output_tensor = dataclasses.asdict(tensors_dict[output.tensor_id])
        producers_consumers = producers_consumers_dict.get(output.tensor_id)
        output_tensor.update(
            {
                "id": output_tensor.pop("tensor_id"),
                "consumers": producers_consumers.consumers,
                "producers": producers_consumers.producers,
            }
        )

        output_data = dataclasses.asdict(output)
        outputs_dict[output.operation_id].append(dict(**output_data, **output_tensor))
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

    inputs_data = [
        list(inputs_dict.values())[0][0] if len(inputs_dict.values()) else []
    ]
    outputs_data = [
        list(outputs_dict.values())[0][0] if len(outputs_dict.values()) else []
    ]

    return dict(
        **operation_data,
        l1_sizes=l1_sizes,
        device_operations=device_operations.captured_graph if device_operations else [],
        stack_trace=stack_trace or "",
        buffers=buffer_list,
        arguments=arguments_data,
        inputs=inputs_data,
        outputs=outputs_data,
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
