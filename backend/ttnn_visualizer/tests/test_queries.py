import unittest
import sqlite3
from ttnn_visualizer.models import (
    Operation,
    Device,
    DeviceOperation,
    Buffer,
    Tensor,
    InputTensor,
    OutputTensor,
    OperationArgument,
    StackTrace,
    ProducersConsumers,
    BufferPage,
    BufferType,
)
from ttnn_visualizer.queries import DatabaseQueries


class TestDatabaseQueries(unittest.TestCase):

    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.db_queries = DatabaseQueries(connection=self.connection)
        self._create_tables()

    def tearDown(self):
        self.connection.close()

    def _create_tables(self):
        schema = """
        CREATE TABLE devices (
            device_id int,
            num_y_cores int,
            num_x_cores int,
            num_y_compute_cores int,
            num_x_compute_cores int,
            worker_l1_size int,
            l1_num_banks int,
            l1_bank_size int,
            address_at_first_l1_bank int,
            address_at_first_l1_cb_buffer int,
            num_banks_per_storage_core int,
            num_compute_cores int,
            num_storage_cores int,
            total_l1_memory int,
            total_l1_for_tensors int,
            total_l1_for_interleaved_buffers int,
            total_l1_for_sharded_buffers int,
            cb_limit int
        );
        CREATE TABLE captured_graph (
            operation_id int,
            captured_graph text
        );
        CREATE TABLE buffers (
            operation_id int,
            device_id int,
            address int,
            max_size_per_bank int,
            buffer_type int
        );
        CREATE TABLE tensors (
            tensor_id int UNIQUE,
            shape text,
            dtype text,
            layout text,
            memory_config text,
            device_id int,
            address int,
            buffer_type int
        );
        CREATE TABLE operation_arguments (
            operation_id int,
            name text,
            value text
        );
        CREATE TABLE stack_traces (
            operation_id int,
            stack_trace text
        );
        CREATE TABLE input_tensors (
            operation_id int,
            input_index int,
            tensor_id int
        );
        CREATE TABLE output_tensors (
            operation_id int,
            output_index int,
            tensor_id int
        );
        CREATE TABLE operations (
            operation_id int UNIQUE,
            name text,
            duration float
        );
        CREATE TABLE buffer_pages (
            operation_id INT,
            device_id INT,
            address INT,
            core_y INT,
            core_x INT,
            bank_id INT,
            page_index INT,
            page_address INT,
            page_size INT,
            buffer_type INT
        );
        """
        self.connection.executescript(schema)

    def test_query_devices(self):
        self.connection.execute(
            "INSERT INTO devices VALUES (1, 4, 4, 2, 2, 1024, 4, 256, 0, 0, 1, 2, 2, 4096, 2048, 2048, 2048, 256)"
        )
        devices = list(self.db_queries.query_devices())
        self.assertEqual(len(devices), 1)
        device = devices[0]
        self.assertIsInstance(device, Device)
        self.assertEqual(device.device_id, 1)

    def test_query_device_operations(self):
        self.connection.execute(
            'INSERT INTO captured_graph VALUES (1, \'[{"counter": 1, "data": "value1"}]\')'
        )
        device_operations = list(self.db_queries.query_device_operations())
        self.assertEqual(len(device_operations), 1)
        device_operation = device_operations[0]
        self.assertIsInstance(device_operation, DeviceOperation)
        self.assertEqual(device_operation.operation_id, 1)

    def test_query_device_operations_by_operation_id(self):
        self.connection.execute(
            'INSERT INTO captured_graph VALUES (1, \'[{"counter": 1, "data": "value1"}]\')'
        )
        device_operation = self.db_queries.query_device_operations_by_operation_id(1)
        self.assertIsInstance(device_operation, DeviceOperation)
        self.assertEqual(device_operation.operation_id, 1)

        no_operation = self.db_queries.query_device_operations_by_operation_id(999)
        self.assertIsNone(no_operation)

    def test_query_buffer_pages(self):
        # Insert sample data into buffer_pages table
        self.connection.execute(
            "INSERT INTO buffer_pages (operation_id, device_id, address, core_y, core_x, bank_id, page_index, page_address, page_size, buffer_type) "
            "VALUES (1, 1, 1234, 0, 0, 1, 0, 1000, 4096, 0)"
        )

        # Query without any filters
        buffer_pages = list(self.db_queries.query_buffer_pages())
        self.assertEqual(len(buffer_pages), 1)

        # Validate the returned buffer page
        buffer_page = buffer_pages[0]
        self.assertIsInstance(buffer_page, BufferPage)
        self.assertEqual(buffer_page.operation_id, 1)
        self.assertEqual(buffer_page.address, 1234)
        self.assertEqual(buffer_page.buffer_type, BufferType(0).value)

        # Query with filter by operation_id
        buffer_pages = list(self.db_queries.query_buffer_pages(operation_id=1))
        self.assertEqual(len(buffer_pages), 1)

        # Query with filter by address
        buffer_pages = list(self.db_queries.query_buffer_pages(address=1234))
        self.assertEqual(len(buffer_pages), 1)

        # Query with filter by buffer_type
        buffer_pages = list(
            self.db_queries.query_buffer_pages(buffer_type=BufferType(0).value)
        )
        self.assertEqual(len(buffer_pages), 1)

        # Query with a non-matching filter
        buffer_pages = list(self.db_queries.query_buffer_pages(operation_id=9999))
        self.assertEqual(len(buffer_pages), 0)

    def test_query_buffers(self):
        self.connection.execute("INSERT INTO buffers VALUES (1, 1, 0, 1024, 0)")
        buffers = list(self.db_queries.query_buffers(1))
        self.assertEqual(len(buffers), 1)
        buffer = buffers[0]
        self.assertIsInstance(buffer, Buffer)
        self.assertEqual(buffer.operation_id, 1)

    def test_query_tensors(self):
        self.connection.execute(
            "INSERT INTO tensors VALUES (1, '(2,2)', 'float32', 'NCHW', 'default', 1, 0, 0)"
        )
        tensors = list(self.db_queries.query_tensors())
        self.assertEqual(len(tensors), 1)
        tensor = tensors[0]
        self.assertIsInstance(tensor, Tensor)
        self.assertEqual(tensor.tensor_id, 1)

    def test_query_operation_arguments(self):
        self.connection.execute(
            "INSERT INTO operation_arguments VALUES (1, 'arg1', 'value1')"
        )
        args = list(self.db_queries.query_operation_arguments())
        self.assertEqual(len(args), 1)
        arg = args[0]
        self.assertIsInstance(arg, OperationArgument)
        self.assertEqual(arg.operation_id, 1)

    def test_query_stack_traces(self):
        self.connection.execute("INSERT INTO stack_traces VALUES (1, 'trace1')")
        traces = list(self.db_queries.query_stack_traces())
        self.assertEqual(len(traces), 1)
        trace = traces[0]
        self.assertIsInstance(trace, StackTrace)
        self.assertEqual(trace.operation_id, 1)

    def test_query_input_tensors(self):
        self.connection.execute("INSERT INTO input_tensors VALUES (1, 0, 1)")
        inputs = list(self.db_queries.query_input_tensors())
        self.assertEqual(len(inputs), 1)
        input_tensor = inputs[0]
        self.assertIsInstance(input_tensor, InputTensor)
        self.assertEqual(input_tensor.operation_id, 1)

    def test_query_output_tensors(self):
        self.connection.execute("INSERT INTO output_tensors VALUES (1, 0, 1)")
        outputs = list(self.db_queries.query_output_tensors())
        self.assertEqual(len(outputs), 1)
        output_tensor = outputs[0]
        self.assertIsInstance(output_tensor, OutputTensor)
        self.assertEqual(output_tensor.operation_id, 1)

    def test_query_operations(self):
        self.connection.execute("INSERT INTO operations VALUES (1, 'op1', 2.0)")
        operations = list(self.db_queries.query_operations())
        self.assertEqual(len(operations), 1)
        operation = operations[0]
        self.assertIsInstance(operation, Operation)
        self.assertEqual(operation.operation_id, 1)

    def test_query_producers_consumers(self):
        self.connection.execute(
            "INSERT INTO tensors VALUES (1, '(2,2)', 'float32', 'NCHW', 'default', 1, 0, 0)"
        )
        self.connection.execute("INSERT INTO input_tensors VALUES (1, 0, 1)")
        self.connection.execute("INSERT INTO output_tensors VALUES (1, 0, 1)")

        producers_consumers = list(self.db_queries.query_producers_consumers())
        self.assertEqual(len(producers_consumers), 1)
        pc = producers_consumers[0]
        self.assertEqual(pc.tensor_id, 1)
        self.assertIn(1, pc.producers)
        self.assertIn(1, pc.consumers)

        # Test with no producers or consumers
        self.connection.execute("DELETE FROM input_tensors")
        self.connection.execute("DELETE FROM output_tensors")

        producers_consumers_empty = list(self.db_queries.query_producers_consumers())
        self.assertEqual(len(producers_consumers_empty), 1)
        pc_empty = producers_consumers_empty[0]
        self.assertEqual(pc_empty.tensor_id, 1)
        self.assertEqual(pc_empty.producers, [])
        self.assertEqual(pc_empty.consumers, [])


if __name__ == "__main__":
    unittest.main()
