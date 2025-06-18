# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

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
    serialize_operation_buffers,
    serialize_operations_buffers,
    serialize_devices,
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
                "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::DRAM,shard_spec=std::nullopt)",
                1,
                1000,
                BufferType.DRAM,
                [25],
            ),
            Tensor(
                2,
                "shape2",
                "dtype2",
                "layout2",
                "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::DRAM,shard_spec=std::nullopt)",
                2,
                2000,
                BufferType.L1,
                [25],
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
                        "memory_config": {
                            "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                            "shard_spec": "std::nullopt",
                        },
                        "device_id": 1,
                        "address": 1000,
                        "buffer_type": 0,
                        "device_addresses": [25],
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
                        "memory_config": {
                            "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                            "shard_spec": "std::nullopt",
                        },
                        "device_id": 1,
                        "address": 1000,
                        "buffer_type": 0,
                        "device_addresses": [25],
                    }
                ],
            }
        ]

        self.assertEqual(result, expected)

    def test_serialize_operations_buffers(self):
        operations = [
            Operation(1, "op1", 0.5),
            Operation(2, "op2", 1.0),
        ]
        buffers = [
            Buffer(1, 1, 1000, 256, BufferType.DRAM),
            Buffer(1, 2, 2000, 512, BufferType.L1),
            Buffer(2, 3, 3000, 1024, BufferType.L1),
        ]

        result = serialize_operations_buffers(operations, buffers)

        expected = [
            {
                "id": 1,
                "name": "op1",
                "buffers": [
                    {
                        "device_id": 1,
                        "address": 1000,
                        "buffer_type": 0,
                        "size": 256,
                    },
                    {
                        "device_id": 2,
                        "address": 2000,
                        "buffer_type": 1,
                        "size": 512,
                    },
                ],
            },
            {
                "id": 2,
                "name": "op2",
                "buffers": [
                    {
                        "device_id": 3,
                        "address": 3000,
                        "buffer_type": 1,
                        "size": 1024,
                    },
                ],
            },
        ]

        self.assertEqual(repr(result), repr(expected))

    def test_serialize_devices(self):
        devices = [
            Device(1, 4, 4, 2, 2, 256, 4, 64, 0, 0, 1, 2, 512, 256, 128, 64, 1, 512),
            Device(
                2, 8, 8, 4, 4, 512, 8, 128, 1, 1, 2, 4, 1024, 512, 256, 128, 2, 1024
            ),
        ]

        result = serialize_devices(devices)

        expected = [
            {
                "address_at_first_l1_bank": 0,
                "address_at_first_l1_cb_buffer": 0,
                "cb_limit": 512,
                "device_id": 1,
                "l1_bank_size": 64,
                "l1_num_banks": 4,
                "num_banks_per_storage_core": 1,
                "num_compute_cores": 2,
                "num_storage_cores": 512,
                "num_x_compute_cores": 2,
                "num_x_cores": 4,
                "num_y_compute_cores": 2,
                "num_y_cores": 4,
                "total_l1_for_interleaved_buffers": 64,
                "total_l1_for_sharded_buffers": 1,
                "total_l1_for_tensors": 128,
                "total_l1_memory": 256,
                "worker_l1_size": 256,
            },
            {
                "address_at_first_l1_bank": 1,
                "address_at_first_l1_cb_buffer": 1,
                "cb_limit": 1024,
                "device_id": 2,
                "l1_bank_size": 128,
                "l1_num_banks": 8,
                "num_banks_per_storage_core": 2,
                "num_compute_cores": 4,
                "num_storage_cores": 1024,
                "num_x_compute_cores": 4,
                "num_x_cores": 8,
                "num_y_compute_cores": 4,
                "num_y_cores": 8,
                "total_l1_for_interleaved_buffers": 128,
                "total_l1_for_sharded_buffers": 2,
                "total_l1_for_tensors": 256,
                "total_l1_memory": 512,
                "worker_l1_size": 512,
            },
        ]

        # Assert that the serialized devices match the expected output
        self.assertEqual(result, expected)

    def test_serialize_operation_buffers(self):
        operation = Operation(1, "op1", 0.5)
        operation_buffers = [
            Buffer(1, 1, 1000, 256, BufferType.DRAM),
            Buffer(1, 2, 2000, 512, BufferType.L1),
        ]

        result = serialize_operation_buffers(operation, operation_buffers)

        expected = {
            "id": 1,
            "name": "op1",
            "buffers": [
                {
                    "device_id": 1,
                    "address": 1000,
                    "buffer_type": 0,
                    "size": 256,
                },
                {
                    "device_id": 2,
                    "address": 2000,
                    "buffer_type": 1,
                    "size": 512,
                },
            ],
        }

        self.assertEqual(repr(result), repr(expected))

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
                "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::DRAM,shard_spec=std::nullopt)",
                1,
                1000,
                BufferType.DRAM,
                [25],
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
                    "memory_config": {
                        "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                        "shard_spec": "std::nullopt",
                    },
                    "device_id": 1,
                    "address": 1000,
                    "buffer_type": 0,
                    "device_addresses": [25],
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
                    "memory_config": {
                        "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                        "shard_spec": "std::nullopt",
                    },
                    "device_id": 1,
                    "address": 1000,
                    "buffer_type": 0,
                    "device_addresses": [25],
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
                "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::DRAM,shard_spec=std::nullopt)",
                1,
                1000,
                BufferType.DRAM,
                [200, 300]
            )
        ]
        devices = [
            Device(1, 4, 4, 2, 2, 256, 4, 64, 0, 0, 1, 2, 512, 256, 128, 64, 1, 512)
        ]
        producers_consumers = [ProducersConsumers(1, [2], [3])]
        device_operations = [DeviceOperation(1, '[{"counter": 1, "op_id": 1}]')]

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
                    "consumers": [3],
                    "device_id": 1,
                    "dtype": "dtype1",
                    "id": 1,
                    "input_index": 0,
                    "layout": "layout1",
                    "memory_config": {
                        "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                        "shard_spec": "std::nullopt",
                    },
                    "operation_id": 1,
                    "producers": [2],
                    "shape": "shape1",
                    "device_addresses": [200, 300]
                }
            ],
            "l1_sizes": [256],
            "name": "op1",
            "outputs": [
                {
                    "address": 1000,
                    "buffer_type": 0,
                    "consumers": [3],
                    "device_id": 1,
                    "dtype": "dtype1",
                    "id": 1,
                    "layout": "layout1",
                    "memory_config": {
                        "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                        "shard_spec": "std::nullopt",
                    },
                    "operation_id": 1,
                    "output_index": 0,
                    "producers": [2],
                    "shape": "shape1",
                    "device_addresses": [200, 300],
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
                "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::DRAM,shard_spec=std::nullopt)",
                1,
                1000,
                BufferType.DRAM,
                [500, 1500],
            ),
            Tensor(
                2,
                "shape2",
                "dtype2",
                "layout2",
                "MemoryConfig(memory_layout=TensorMemoryLayout::INTERLEAVED,buffer_type=BufferType::DRAM,shard_spec=std::nullopt)",
                2,
                2000,
                BufferType.L1,
                [2000, 2500],
            ),
        ]
        producers_consumers = [
            ProducersConsumers(1, [2], [3]),
            ProducersConsumers(2, [], []),
        ]

        result = serialize_tensors(tensors, producers_consumers, [], [])

        expected = [
            {
                "id": 1,
                "shape": "shape1",
                "dtype": "dtype1",
                "layout": "layout1",
                "memory_config": {
                    "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                    "shard_spec": "std::nullopt",
                },
                "device_id": 1,
                "address": 1000,
                "buffer_type": 0,
                "comparison": None,
                "consumers": [3],
                "producers": [2],
                "device_addresses": [500, 1500],
            },
            {
                "id": 2,
                "shape": "shape2",
                "dtype": "dtype2",
                "layout": "layout2",
                "memory_config": {
                    "memory_layout": "TensorMemoryLayout::INTERLEAVED",
                    "shard_spec": "std::nullopt",
                },
                "device_id": 2,
                "address": 2000,
                "buffer_type": 1,
                "comparison": None,
                "consumers": [],
                "producers": [],
                "device_addresses": [2000, 2500],
            },
        ]

        self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
