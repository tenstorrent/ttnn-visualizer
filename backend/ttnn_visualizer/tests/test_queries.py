# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC


import tempfile
import sqlite3
import tempfile
import unittest
from unittest.mock import Mock
from unittest.mock import patch

from ttnn_visualizer.models import (
    DeviceOperation,
    TensorComparisonRecord,
)
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.queries import LocalQueryRunner


class TestQueryTable(unittest.TestCase):
    """Tests query construction logic"""

    def setUp(self):
        # Mock the query_runner
        self.mock_query_runner = Mock()
        self.db_queries = DatabaseQueries(connection=Mock())
        self.db_queries.query_runner = self.mock_query_runner

    def test_query_table_no_filters_or_conditions(self):
        self.db_queries._query_table("test_table")
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1", []
        )

    def test_query_table_single_filter(self):
        filters = {"column1": "value1"}
        self.db_queries._query_table("test_table", filters)
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1 AND column1 = ?", ["value1"]
        )

    def test_query_table_multiple_filters(self):
        filters = {"column1": "value1", "column2": 42}
        self.db_queries._query_table("test_table", filters)
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1 AND column1 = ? AND column2 = ?",
            ["value1", 42],
        )

    def test_query_table_filter_with_none_value(self):
        filters = {"column1": "value1", "column2": None}
        self.db_queries._query_table("test_table", filters)
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1 AND column1 = ?", ["value1"]
        )

    def test_query_table_empty_list_filter(self):
        filters = {"column1": []}
        self.db_queries._query_table("test_table", filters)
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1", []
        )

    def test_query_table_list_based_filter(self):
        filters = {"column1": [1, 2, 3]}
        self.db_queries._query_table("test_table", filters)
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1 AND column1 IN (?, ?, ?)", [1, 2, 3]
        )

    def test_query_table_with_additional_conditions(self):
        additional_conditions = "AND column3 > ?"
        additional_params = [100]
        self.db_queries._query_table(
            "test_table",
            additional_conditions=additional_conditions,
            additional_params=additional_params,
        )
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1 AND column3 > ?", [100]
        )

    def test_query_table_with_filters_and_conditions(self):
        filters = {"column1": "value1"}
        additional_conditions = "AND column3 > ?"
        additional_params = [100]
        self.db_queries._query_table(
            "test_table", filters, additional_conditions, additional_params
        )
        self.mock_query_runner.execute_query.assert_called_once_with(
            "SELECT * FROM test_table WHERE 1=1 AND column1 = ? AND column3 > ?",
            ["value1", 100],
        )

    def tearDown(self):
        self.mock_query_runner.reset_mock()


class TestDatabaseQueries(unittest.TestCase):
    """
    Tests specific table querying with filters and conditions
    """

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
        CREATE TABLE local_tensor_comparison_records (
            tensor_id int,
            golden_tensor_id int,
            matches int,
            desired_pcc float,
            actual_pcc float
        );
        CREATE TABLE global_tensor_comparison_records (
            tensor_id int,
            golden_tensor_id int,
            matches int,
            desired_pcc float,
            actual_pcc float
        );

        """
        self.connection.executescript(schema)

    def test_init_with_valid_connection(self):
        connection = sqlite3.connect(":memory:")
        db_queries = DatabaseQueries(connection=connection)
        self.assertIsInstance(db_queries.query_runner, LocalQueryRunner)
        connection.close()

    def test_init_with_missing_instance_and_connection(self):
        with self.assertRaises(ValueError) as context:
            DatabaseQueries(instance=None, connection=None)
        self.assertIn(
            "Must provide either an existing connection or instance",
            str(context.exception),
        )


    def test_init_with_valid_local_instance(self):
        with tempfile.NamedTemporaryFile(suffix=".sqlite") as temp_db_file:
            connection = sqlite3.connect(temp_db_file.name)
            connection.execute("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT);")
            connection.close()

            mock_instance = Mock()
            mock_instance.profiler_path = temp_db_file.name
            mock_instance.remote_connection = None

            db_queries = DatabaseQueries(instance=mock_instance)
            self.assertIsInstance(db_queries.query_runner, LocalQueryRunner)

    def test_init_with_invalid_instance(self):
        mock_instance = Mock()
        mock_instance.profiler_path = None
        mock_instance.remote_connection = None
        with self.assertRaises(ValueError) as context:
            DatabaseQueries(instance=mock_instance)
        self.assertIn(
            "Report path must be provided for local queries", str(context.exception)
        )

    def test_check_table_exists(self):
        self.assertTrue(self.db_queries._check_table_exists("devices"))
        self.assertFalse(self.db_queries._check_table_exists("nonexistent_table"))

    def test_query_device_operations(self):
        self.connection.execute(
            'INSERT INTO captured_graph VALUES (1, \'[{"counter": 1, "data": "value1"}]\')'
        )
        results = self.db_queries.query_device_operations(filters={"operation_id": 1})
        self.assertEqual(len(results), 1)
        self.assertIsInstance(results[0], DeviceOperation)

    def test_query_device_operations_table_missing(self):
        self.connection.execute("DROP TABLE captured_graph")
        results = self.db_queries.query_device_operations(filters={"operation_id": 1})
        self.assertEqual(results, [])

    def test_query_operation_arguments(self):
        self.connection.execute(
            "INSERT INTO operation_arguments VALUES (1, 'arg_name', 'arg_value')"
        )
        results = list(
            self.db_queries.query_operation_arguments(filters={"operation_id": 1})
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].name, "arg_name")

    def test_query_operations(self):
        self.connection.execute("INSERT INTO operations VALUES (1, 'op1', 2.0)")
        results = list(self.db_queries.query_operations(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].name, "op1")

    def test_query_buffers(self):
        self.connection.execute("INSERT INTO buffers VALUES (1, 1, 100, 1024, 0)")
        results = list(self.db_queries.query_buffers(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].address, 100)

    def test_query_stack_traces(self):
        self.connection.execute("INSERT INTO stack_traces VALUES (1, 'trace_data')")
        results = list(self.db_queries.query_stack_traces(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].stack_trace, "trace_data")

    def test_query_tensor_comparisons(self):
        self.connection.execute(
            """
            INSERT INTO local_tensor_comparison_records
            (tensor_id, golden_tensor_id, matches, desired_pcc, actual_pcc)
            VALUES (1, 10, 1, 0.9, 0.8)
            """
        )
        results = list(
            self.db_queries.query_tensor_comparisons(local=True, filters={"matches": 1})
        )

        self.assertEqual(len(results), 1)
        comparison = results[0]
        self.assertIsInstance(comparison, TensorComparisonRecord)
        self.assertEqual(comparison.tensor_id, 1)
        self.assertEqual(comparison.golden_tensor_id, 10)
        self.assertTrue(comparison.matches)
        self.assertAlmostEqual(comparison.desired_pcc, 0.9)
        self.assertAlmostEqual(comparison.actual_pcc, 0.8)

    def test_query_buffer_pages(self):
        self.connection.execute(
            "INSERT INTO buffer_pages VALUES (1, 1, 100, 0, 0, 1, 0, 1000, 4096, 0)"
        )
        results = list(self.db_queries.query_buffer_pages(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].address, 100)

    def test_query_tensors(self):
        self.connection.execute(
            "INSERT INTO tensors VALUES (1, '(2,2)', 'float32', 'NCHW', 'default', 1, 100, 0)"
        )
        results = list(self.db_queries.query_tensors(filters={"tensor_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].tensor_id, 1)

    def test_query_input_tensors(self):
        self.connection.execute("INSERT INTO input_tensors VALUES (1, 0, 1)")
        results = list(self.db_queries.query_input_tensors(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].operation_id, 1)

    def test_query_output_tensors(self):
        self.connection.execute("INSERT INTO output_tensors VALUES (1, 0, 1)")
        results = list(
            self.db_queries.query_output_tensors(filters={"operation_id": 1})
        )
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].operation_id, 1)

    def test_query_devices(self):
        self.connection.execute(
            "INSERT INTO devices VALUES (1, 4, 4, 2, 2, 1024, 4, 256, 0, 0, 1, 2, 2, 4096, 2048, 2048, 2048, 256)"
        )
        results = list(self.db_queries.query_devices(filters={"device_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].device_id, 1)

    def test_query_producers_consumers(self):
        self.connection.execute(
            "INSERT INTO tensors VALUES (1, '(2,2)', 'float32', 'NCHW', 'default', 1, 100, 0)"
        )
        self.connection.execute("INSERT INTO input_tensors VALUES (2, 0, 1)")
        self.connection.execute("INSERT INTO output_tensors VALUES (1, 0, 1)")

        results = list(self.db_queries.query_producers_consumers())

        self.assertEqual(len(results), 1)
        pc = results[0]
        self.assertEqual(pc.tensor_id, 1)
        self.assertIn(1, pc.producers)
        self.assertIn(2, pc.consumers)

    def test_query_next_buffer(self):
        self.connection.execute("INSERT INTO buffers VALUES (1, 1, 100, 1024, 0)")
        self.connection.execute("INSERT INTO buffers VALUES (2, 1, 100, 2048, 0)")
        result = self.db_queries.query_next_buffer(operation_id=1, address=100)
        self.assertIsNotNone(result)
        self.assertEqual(result.operation_id, 2)


if __name__ == "__main__":
    unittest.main()
