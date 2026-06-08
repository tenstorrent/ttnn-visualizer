# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import unittest

import orjson
from ttnn_visualizer.models import (
    Buffer,
    BufferChunk,
    BufferPage,
    BufferType,
    Device,
    DeviceOperation,
    InputTensor,
    Operation,
    OperationArgument,
    OutputTensor,
    ProducersConsumers,
    StackTrace,
    Tensor,
)
from ttnn_visualizer.serializers import (
    serialize_buffer_chunks,
    serialize_buffer_pages,
    serialize_devices,
    serialize_inputs_outputs,
    serialize_operation,
    serialize_operation_buffers,
    serialize_operations,
    serialize_operations_buffers,
    serialize_tensors,
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
            Device(1, 4, 4, 2, 2, 256, 4, 64, 0, 0, 1, 2, 256, 128, 64, 1, 512, 0)
        ]
        producers_consumers = [ProducersConsumers(1, [2], [3])]
        device_operations = [DeviceOperation(1, '[{"id": 1, "op_id": 1}]')]

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
                "rank": 0,
                "stack_trace": "trace1",
                "stack_trace_source_file_id": None,
                "device_operations": [{"id": 1, "op_id": 1}],
                "arguments": [
                    {
                        "operation_id": 1,
                        "name": "arg1",
                        "value": "value1",
                        "rank": 0,
                    },
                    {
                        "operation_id": 1,
                        "name": "arg2",
                        "value": "value2",
                        "rank": 0,
                    },
                ],
                "inputs": [
                    {
                        "input_index": 0,
                        "id": 1,
                        "operation_id": 1,
                        "rank": 0,
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
                        "size": None,
                        "lifetime": None,
                    }
                ],
                "outputs": [
                    {
                        "output_index": 0,
                        "id": 1,
                        "operation_id": 1,
                        "rank": 0,
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
                        "size": None,
                        "lifetime": None,
                    }
                ],
                "error": None,
            }
        ]

        self.assertEqual(orjson.loads(orjson.dumps(result)), expected)

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
                        "buffer_layout": None,
                        "size": 256,
                        "rank": 0,
                    },
                    {
                        "device_id": 2,
                        "address": 2000,
                        "buffer_type": 1,
                        "buffer_layout": None,
                        "size": 512,
                        "rank": 0,
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
                        "buffer_layout": None,
                        "size": 1024,
                        "rank": 0,
                    },
                ],
            },
        ]

        self.assertEqual(repr(result), repr(expected))

    def test_serialize_devices(self):
        devices = [
            Device(1, 4, 4, 2, 2, 256, 4, 64, 0, 0, 1, 2, 256, 128, 64, 1, 512, 0),
            Device(2, 8, 8, 4, 4, 512, 8, 128, 1, 1, 2, 4, 512, 256, 128, 2, 1024, 0),
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
                "num_x_compute_cores": 2,
                "num_x_cores": 4,
                "num_y_compute_cores": 2,
                "num_y_cores": 4,
                "total_l1_for_interleaved_buffers": 64,
                "total_l1_for_sharded_buffers": 1,
                "total_l1_for_tensors": 128,
                "total_l1_memory": 256,
                "worker_l1_size": 256,
                "rank": 0,
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
                "num_x_compute_cores": 4,
                "num_x_cores": 8,
                "num_y_compute_cores": 4,
                "num_y_cores": 8,
                "total_l1_for_interleaved_buffers": 128,
                "total_l1_for_sharded_buffers": 2,
                "total_l1_for_tensors": 256,
                "total_l1_memory": 512,
                "worker_l1_size": 512,
                "rank": 0,
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
                    "buffer_layout": None,
                    "size": 256,
                    "rank": 0,
                },
                {
                    "device_id": 2,
                    "address": 2000,
                    "buffer_type": 1,
                    "buffer_layout": None,
                    "size": 512,
                    "rank": 0,
                },
            ],
        }

        self.assertEqual(repr(result), repr(expected))

    def test_serialize_inputs_outputs(self):
        inputs = [InputTensor(1, 0, 1)]
        outputs = [OutputTensor(1, 0, 1)]
        producers_consumers = [ProducersConsumers(1, [2], [3])]
        tensors_dict = {
            (1, 0): Tensor(
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
                    "rank": 0,
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
                    "size": None,
                    "lifetime": None,
                }
            ]
        }

        expected_outputs = {
            1: [
                {
                    "operation_id": 1,
                    "output_index": 0,
                    "id": 1,
                    "rank": 0,
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
                    "size": None,
                    "lifetime": None,
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
                [200, 300],
            )
        ]
        devices = [
            Device(1, 4, 4, 2, 2, 256, 4, 64, 0, 0, 1, 2, 256, 128, 64, 1, 512, 0)
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
            "arguments": [
                {"name": "arg1", "operation_id": 1, "value": "value1", "rank": 0}
            ],
            "buffers": [
                {
                    "address": 1000,
                    "buffer_layout": None,
                    "buffer_type": 0,
                    "device_id": 1,
                    "max_size_per_bank": 256,
                    "operation_id": 1,
                    "rank": 0,
                }
            ],
            "device_operations": [{"counter": 1, "op_id": 1}],
            "duration": 0.5,
            "id": 1,
            "rank": 0,
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
                    "device_addresses": [200, 300],
                    "size": None,
                    "lifetime": None,
                    "rank": 0,
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
                    "size": None,
                    "lifetime": None,
                    "rank": 0,
                }
            ],
            "stack_trace": "trace1",
            "stack_trace_source_file_id": None,
            "error": None,
        }

        self.assertEqual(orjson.loads(orjson.dumps(result)), expected)

    def test_serialize_operations_with_stack_trace_source_file_id(self):
        operations = [Operation(1, "op1", 0.5)]
        stack_traces = [StackTrace(1, "trace text", source_file_id=42)]
        result = serialize_operations(
            [],
            [],
            operations,
            [],
            stack_traces,
            [],
            [],
            [],
            [],
        )
        self.assertEqual(result[0]["stack_trace"], "trace text")
        self.assertEqual(result[0]["stack_trace_source_file_id"], 42)

    def test_serialize_operations_null_source_file_id_does_not_fallback_to_rank_zero(
        self,
    ):
        """Explicit NULL at a rank must not inherit rank-0's source_file_id."""
        operations = [Operation(1, "op1", 0.5, rank=1)]
        stack_traces = [
            StackTrace(1, "trace rank 0", source_file_id=42, rank=0),
            StackTrace(1, "trace rank 1", source_file_id=None, rank=1),
        ]
        result = serialize_operations(
            [],
            [],
            operations,
            [],
            stack_traces,
            [],
            [],
            [],
            [],
        )
        self.assertEqual(result[0]["stack_trace"], "trace rank 1")
        self.assertIsNone(result[0]["stack_trace_source_file_id"])

    def test_serialize_operation_with_stack_trace_source_file_id(self):
        operation = Operation(1, "op1", 0.5)
        stack_trace = StackTrace(1, "trace text", source_file_id=7)
        result = serialize_operation(
            [],
            [],
            operation,
            [],
            [],
            stack_trace,
            [],
            [],
            [],
            [],
            [],
            [],
        )
        self.assertEqual(result["stack_trace"], "trace text")
        self.assertEqual(result["stack_trace_source_file_id"], 7)

    def test_serialize_buffer_chunks(self):
        chunks = [
            BufferChunk(
                operation_id=1,
                device_id=0,
                address=100,
                bank_id=1,
                core_x=0,
                core_y=0,
                chunk_address=1000,
                chunk_size=48,
                page_size=24,
                num_pages=2,
                buffer_type=BufferType.DRAM,
            ),
            BufferChunk(
                operation_id=1,
                device_id=0,
                address=200,
                bank_id=2,
                core_x=1,
                core_y=0,
                chunk_address=2000,
                chunk_size=16,
                page_size=16,
                num_pages=1,
                buffer_type=BufferType.L1,
            ),
        ]

        result = serialize_buffer_chunks(chunks)

        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["id"], "1_0_100_1_0_0_0_0")
        self.assertEqual(result[0]["buffer_type"], BufferType.DRAM.value)
        self.assertEqual(result[0]["chunk_size"], 48)
        self.assertEqual(result[0]["num_pages"], 2)
        self.assertEqual(result[0]["rank"], 0)
        self.assertEqual(result[1]["id"], "1_0_200_2_1_0_1_0")
        self.assertEqual(result[1]["buffer_type"], BufferType.L1.value)
        self.assertEqual(
            orjson.loads(orjson.dumps(result))[0]["id"], "1_0_100_1_0_0_0_0"
        )

    def test_serialize_buffer_chunks_id_disambiguates_device_rank_and_buffer_type(self):
        # Two chunks that share (op, addr, bank, core_x, core_y) but differ on
        # device, rank, or buffer_type must produce distinct ids. Regression
        # check for the legacy id format which only encoded the first five
        # fields and would collide across devices.
        base = dict(
            operation_id=7,
            address=2048,
            bank_id=3,
            core_x=4,
            core_y=5,
            chunk_address=2048,
            chunk_size=64,
            page_size=32,
            num_pages=2,
        )
        chunks = [
            BufferChunk(device_id=0, buffer_type=BufferType.DRAM, rank=0, **base),
            BufferChunk(device_id=1, buffer_type=BufferType.DRAM, rank=0, **base),
            BufferChunk(device_id=0, buffer_type=BufferType.L1, rank=0, **base),
            BufferChunk(device_id=0, buffer_type=BufferType.DRAM, rank=1, **base),
        ]

        ids = [row["id"] for row in serialize_buffer_chunks(chunks)]

        self.assertEqual(len(set(ids)), 4)

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
                "rank": 0,
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
                "rank": 0,
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
                "size": None,
                "lifetime": None,
                "rank": 0,
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
                "size": None,
                "lifetime": None,
                "rank": 0,
            },
        ]

        self.assertEqual(result, expected)


if __name__ == "__main__":
    unittest.main()
