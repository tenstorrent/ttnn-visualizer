# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import dataclasses
from collections import defaultdict
from typing import List

from ttnn_visualizer.models import BufferType, Operation, TensorComparisonRecord


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
    error_records=None,
):
    tensors_dict = {t.tensor_id: t for t in tensors}
    device_operations_dict = {
        do.operation_id: do.captured_graph
        for do in device_operations
        if hasattr(do, "operation_id")
    }

    stack_traces_dict = {st.operation_id: st.stack_trace for st in stack_traces}

    errors_dict = {}
    if error_records:
        for error in error_records:
            errors_dict[error.operation_id] = error.to_nested_dict()

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
        arguments = [a.to_dict() for a in arguments_dict[operation.operation_id]]
        operation_data = operation.to_dict()
        operation_data["id"] = operation.operation_id
        operation_device_operations = device_operations_dict.get(
            operation.operation_id, []
        )
        id = operation_data.pop("operation_id", None)

        error_data = errors_dict.get(operation.operation_id)

        results.append(
            {
                **operation_data,
                "id": id,
                "stack_trace": stack_traces_dict.get(operation.operation_id),
                "device_operations": operation_device_operations,
                "arguments": arguments,
                "inputs": inputs,
                "outputs": outputs,
                "error": error_data,
            }
        )
    return results


def serialize_inputs_outputs(
    inputs,
    outputs,
    producers_consumers,
    tensors_dict,
    comparisons=None,
):
    producers_consumers_dict = {pc.tensor_id: pc for pc in producers_consumers}

    def attach_tensor_data(values):
        values_dict = defaultdict(list)
        for value in values:
            tensor = tensors_dict.get(value.tensor_id)
            tensor_dict = tensor.to_dict()
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
            if comparisons:
                comparison = comparisons.get(value.tensor_id)
                value_dict.update({"comparison": comparison})

            values_dict[value.operation_id].append({**value_dict, **tensor_dict})
        return values_dict

    inputs_dict = attach_tensor_data(inputs)
    outputs_dict = attach_tensor_data(outputs)
    return inputs_dict, outputs_dict


def serialize_buffer_pages(buffer_pages):
    # Collect device-specific data if needed

    # Serialize each buffer page to a dictionary using dataclasses.asdict
    buffer_pages_list = [page.to_dict() for page in buffer_pages]

    # Optionally, modify or adjust the serialized data as needed
    for page_data in buffer_pages_list:
        # Set a custom id field if needed
        page_data["id"] = f"{page_data['operation_id']}_{page_data['page_index']}"

        # If the buffer_type is handled by an enum, adjust it similarly to your BufferPage model
        if "buffer_type" in page_data and isinstance(
            page_data["buffer_type"], BufferType
        ):
            page_data["buffer_type"] = page_data["buffer_type"].value

    return buffer_pages_list


def comparisons_by_tensor_id(
    local_comparisons: List[TensorComparisonRecord],
    global_comparisons: List[TensorComparisonRecord],
):
    comparisons = defaultdict(dict)
    for local_comparison in local_comparisons:
        comparisons[local_comparison.tensor_id].update({"local": local_comparison})
    for global_comparison in global_comparisons:
        comparisons[global_comparison.tensor_id].update({"global": global_comparison})
    return comparisons


def serialize_operation(
    buffers,
    inputs,
    operation,
    operation_arguments,
    outputs,
    stack_trace,
    tensors,
    global_tensor_comparisons,
    local_tensor_comparisons,
    devices,
    producers_consumers,
    device_operations,
    error_record=None,
):
    tensors_dict = {t.tensor_id: t for t in tensors}
    comparisons = comparisons_by_tensor_id(
        local_tensor_comparisons, global_tensor_comparisons
    )

    inputs_dict, outputs_dict = serialize_inputs_outputs(
        inputs,
        outputs,
        producers_consumers,
        tensors_dict,
        comparisons,
    )

    buffer_list = [buffer.to_dict() for buffer in buffers]

    l1_sizes = [d.worker_l1_size for d in devices]
    arguments_data = [argument.to_dict() for argument in operation_arguments]
    operation_data = operation.to_dict()
    operation_data["id"] = operation.operation_id

    inputs_data = inputs_dict.get(operation.operation_id)
    outputs_data = outputs_dict.get(operation.operation_id)

    id = operation_data.pop("operation_id", None)

    device_operations_data = []
    for do in device_operations:
        if do.operation_id == operation.operation_id:
            device_operations_data = do.captured_graph
            break

    # Convert error record to nested dict if it exists (excludes operation_id and operation_name)
    error_data = error_record.to_nested_dict() if error_record else None

    return {
        **operation_data,
        "id": id,
        "l1_sizes": l1_sizes,
        "device_operations": device_operations_data,
        "stack_trace": stack_trace.stack_trace if stack_trace else "",
        "buffers": buffer_list,
        "arguments": arguments_data,
        "inputs": inputs_data or [],
        "outputs": outputs_data or [],
        "error": error_data,
    }


def serialize_operation_buffers(operation: Operation, operation_buffers):
    buffer_data = []
    for b in operation_buffers:
        buffer_dict = {
            "device_id": b.device_id,
            "address": b.address,
            "buffer_type": (
                b.buffer_type.value
                if hasattr(b.buffer_type, "value")
                else b.buffer_type
            ),
            "buffer_layout": b.buffer_layout,
            "size": b.max_size_per_bank,
        }
        buffer_data.append(buffer_dict)

    return {
        "id": operation.operation_id,
        "name": operation.name,
        "buffers": buffer_data,
    }


def serialize_devices(devices):
    return [d.to_dict() for d in devices]


def serialize_operations_buffers(operations, buffers):
    # Pre-serialize all buffers once using optimized method with defaultdict
    serialized_buffers = defaultdict(list)
    for b in buffers:
        buffer_dict = {
            "device_id": b.device_id,
            "address": b.address,
            "buffer_type": (
                b.buffer_type.value
                if hasattr(b.buffer_type, "value")
                else b.buffer_type
            ),
            "buffer_layout": b.buffer_layout,
            "size": b.max_size_per_bank,
        }
        serialized_buffers[b.operation_id].append(buffer_dict)

    results = []
    for operation in operations:
        operation_buffers = serialized_buffers[operation.operation_id]
        results.append(
            {
                "id": operation.operation_id,
                "name": operation.name,
                "buffers": operation_buffers,
            }
        )

    return results


def serialize_buffer(buffer):
    return {
        "buffer_type": buffer.buffer_type,
        "device_id": buffer.device_id,
        "size": buffer.max_size_per_bank,
        "address": buffer.address,
    }


def serialize_tensors(
    tensors, producers_consumers, local_comparisons, global_comparisons
):
    producers_consumers_dict = {pc.tensor_id: pc for pc in producers_consumers}
    results = []
    comparisons = comparisons_by_tensor_id(local_comparisons, global_comparisons)
    for tensor in tensors:
        tensor_data = tensor.to_dict()
        tensor_id = tensor_data.pop("tensor_id")
        tensor_data.update(
            {
                "id": tensor_id,
                "comparison": comparisons.get(tensor_id),
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
