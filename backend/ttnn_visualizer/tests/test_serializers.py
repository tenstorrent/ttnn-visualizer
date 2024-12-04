# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import unittest

from ttnn_visualizer.models import (
    Operation,
    OperationArgument,
    Tensor,
    Device,
    InputTensor,
    OutputTensor,
    ProducersConsumers,
    StackTrace,
    DeviceOperation,
    Buffer,
    BufferType,
    BufferPage,
)
from ttnn_visualizer.serializers import (
    serialize_operations,
    serialize_inputs_outputs,
    serialize_operation,
    serialize_tensors,
    serialize_buffer_pages,
)


class TestSerializers(unittest.TestCase):

    def test_serialize_operations(self):
        inputs = [InputTensor(1, 0, 1), InputTensor(2, 1, 2)]
        operation_arguments = [
            OperationArgument(1, "arg1", "value1"),
            OperationArgument(1, "arg2", "value2"),
        ]
        operations = [Operation(1, "op1", 0.5)]
        outputs = [OutputTensor(1, 0, 1)]
        stack_traces = [StackTrace(1, "trace1")]
        tensors = [
            Tensor(
                1,
                "shape1",
                "dtype1",
                "layout1",
                "memory_config1",
                1,
                1000,
                BufferType.DRAM,
            ),
            Tensor(
                2,
                "shape2",
                "dtype2",
                "layout2",
                "memory_config2",
                2,
                2000,
                BufferType.L1,
            ),
        ]
        devices = [
            Device(1, 4, 4, 2, 2, 256, 4, 64, 0, 0, 1, 2, 512, 256, 128, 64, 1, 512)
        ]
        producers_consumers = [ProducersConsumers(1, [2], [3])]
        device_operations = [DeviceOperation(1, '[{"counter": 1, "op_id": 1}]')]

        result = serialize_operations(
            inputs,
            operation_arguments,
            operations,
            outputs,
            stack_traces,
            tensors,
            devices,
            producers_consumers,
            device_operations,
        )

        expected = [
            {
                "id": 1,
                "name": "op1",
                "duration": 0.5,
                "stack_trace": "trace1",
                "device_operations": [{"id": 1, "op_id": 1}],
                "arguments": [
                    {"operation_id": 1, "name": "arg1", "value": "value1"},
                    {"operation_id": 1, "name": "arg2", "value": "value2"},
                ],
                "inputs": [
                    {
                        "input_index": 0,
                        "id": 1,
                        "operation_id": 1,
                        "consumers": [3],
                        "producers": [2],
                        "shape": "shape1",
                        "dtype": "dtype1",
                        "layout": "layout1",
                        "memory_config": "memory_config1",
                        "device_id": 1,
                        "address": 1000,
                        "buffer_type": 0,
                    }
                ],
                "outputs": [
                    {
                        "output_index": 0,
                        "id": 1,
                        "operation_id": 1,
                        "consumers": [3],
                        "producers": [2],
                        "shape": "shape1",
                        "dtype": "dtype1",
                        "layout": "layout1",
                        "memory_config": "memory_config1",
                        "device_id": 1,
                        "address": 1000,
                        "buffer_type": 0,
                    }
                ],
            }
        ]

        self.assertEqual(result, expected)

    def test_serialize_inputs_outputs(self):
        inputs = [InputTensor(1, 0, 1)]
        outputs = [OutputTensor(1, 0, 1)]
        producers_consumers = [ProducersConsumers(1, [2], [3])]
        tensors_dict = {
            1: Tensor(
                1,
                "shape1",
                "dtype1",
                "layout1",
                "memory_config1",
                1,
                1000,
                BufferType.DRAM,
            )
        }

        inputs_dict, outputs_dict = serialize_inputs_outputs(
            inputs, outputs, producers_consumers, tensors_dict
        )

        expected_inputs = {
            1: [
                {
                    "operation_id": 1,
                    "input_index": 0,
                    "id": 1,
                    "consumers": [3],
                    "producers": [2],
                    "shape": "shape1",
                    "dtype": "dtype1",
                    "layout": "layout1",
                    "memory_config": "memory_config1",
                    "device_id": 1,
                    "address": 1000,
                    "buffer_type": 0,
                }
            ]
        }

        expected_outputs = {
            1: [
                {
                    "operation_id": 1,
                    "output_index": 0,
                    "id": 1,
                    "consumers": [3],
                    "producers": [2],
                    "shape": "shape1",
                    "dtype": "dtype1",
                    "layout": "layout1",
                    "memory_config": "memory_config1",
                    "device_id": 1,
                    "address": 1000,
                    "buffer_type": 0,
                }
            ]
        }

        self.assertEqual(inputs_dict, expected_inputs)
        self.assertEqual(outputs_dict, expected_outputs)

    def test_serialize_operation(self):
        buffers = [Buffer(1, 1, 1000, 256, BufferType.DRAM)]
        inputs = [InputTensor(1, 0, 1)]
        operation = Operation(1, "op1", 0.5)
        operation_arguments = [OperationArgument(1, "arg1", "value1")]
        outputs = [OutputTensor(1, 0, 1)]
        stack_trace = StackTrace(1, "trace1")
        tensors = [
            Tensor(
                1,
                "shape1",
                "dtype1",
                "layout1",
                "memory_config1",
                1,
                1000,
                BufferType.DRAM,
            )
        ]
        devices = [
            Device(1, 4, 4, 2, 2, 256, 4, 64, 0, 0, 1, 2, 512, 256, 128, 64, 1, 512)
        ]
        producers_consumers = [ProducersConsumers(1, [2], [3])]
        device_operations = DeviceOperation(1, '[{"counter": 1, "op_id": 1}]')

        result = serialize_operation(
            buffers,
            inputs,
            operation,
            operation_arguments,
            outputs,
            stack_trace,
            tensors,
            [],
            [],
            devices,
            producers_consumers,
            device_operations,
        )
        expected = {
            "arguments": [{"name": "arg1", "operation_id": 1, "value": "value1"}],
            "buffers": [
                {
                    "address": 1000,
                    "buffer_type": 0,
                    "device_id": 1,
                    "max_size_per_bank": 256,
                    "operation_id": 1,
                }
            ],
            "device_operations": [{"id": 1, "op_id": 1}],
            "duration": 0.5,
            "id": 1,
            "inputs": [
                {
                    "address": 1000,
                    "buffer_type": 0,
                    "comparison": {},
                    "consumers": [3],
                    "device_id": 1,
                    "dtype": "dtype1",
                    "id": 1,
                    "input_index": 0,
                    "layout": "layout1",
                    "memory_config": "memory_config1",
                    "operation_id": 1,
                    "producers": [2],
                    "shape": "shape1",
                }
            ],
            "l1_sizes": [256],
            "name": "op1",
            "outputs": [
                {
                    "address": 1000,
                    "buffer_type": 0,
                    "comparison": {},
                    "consumers": [3],
                    "device_id": 1,
                    "dtype": "dtype1",
                    "id": 1,
                    "layout": "layout1",
                    "memory_config": "memory_config1",
                    "operation_id": 1,
                    "output_index": 0,
                    "producers": [2],
                    "shape": "shape1",
                }
            ],
            "stack_trace": "trace1",
        }

        self.assertEqual(result, expected)

    def test_serialize_buffer_pages(self):
        buffer_pages = [
            BufferPage(
                operation_id=1,
                device_id=1,
                address=1234,
                core_y=0,
                core_x=0,
                bank_id=1,
                page_index=0,
                page_address=1000,
                page_size=4096,
                buffer_type=BufferType.DRAM,
            ),
            BufferPage(
                operation_id=2,
                device_id=2,
                address=5678,
                core_y=1,
                core_x=1,
                bank_id=2,
                page_index=1,
                page_address=2000,
                page_size=8192,
                buffer_type=BufferType.L1,
            ),
        ]

        result = serialize_buffer_pages(buffer_pages)

        expected = [
            {
                "operation_id": 1,
                "device_id": 1,
                "address": 1234,
                "core_y": 0,
                "core_x": 0,
                "bank_id": 1,
                "page_index": 0,
                "page_address": 1000,
                "page_size": 4096,
                "buffer_type": 0,
                "id": "1_0",
            },
            {
                "operation_id": 2,
                "device_id": 2,
                "address": 5678,
                "core_y": 1,
                "core_x": 1,
                "bank_id": 2,
                "page_index": 1,
                "page_address": 2000,
                "page_size": 8192,
                "buffer_type": 1,
                "id": "2_1",
            },
        ]

        self.assertEqual(result, expected)

    def test_serialize_tensors(self):
        tensors = [
            Tensor(
                1,
                "shape1",
                "dtype1",
                "layout1",
                "memory_config1",
                1,
                1000,
                BufferType.DRAM,
            ),
            Tensor(
                2,
                "shape2",
                "dtype2",
                "layout2",
                "memory_config2",
                2,
                2000,
                BufferType.L1,
            ),
        ]
        producers_consumers = [
            ProducersConsumers(1, [2], [3]),
            ProducersConsumers(2, [], []),
        ]

        result = serialize_tensors(tensors, producers_consumers)

        expected = [
            {
                "id": 1,
                "shape": "shape1",
                "dtype": "dtype1",
                "layout": "layout1",
                "memory_config": "memory_config1",
                "device_id": 1,
                "address": 1000,
                "buffer_type": 0,
                "consumers": [3],
                "producers": [2],
            },
            {
                "id": 2,
                "shape": "shape2",
                "dtype": "dtype2",
                "layout": "layout2",
                "memory_config": "memory_config2",
                "device_id": 2,
                "address": 2000,
                "buffer_type": 1,
                "consumers": [],
                "producers": [],
            },
        ]

        self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
