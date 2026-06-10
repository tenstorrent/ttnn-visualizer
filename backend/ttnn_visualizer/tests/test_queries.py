# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC


import sqlite3
import tempfile
import unittest
from unittest.mock import Mock, patch

from ttnn_visualizer.exceptions import ProfilerReportNotLoadedException
from ttnn_visualizer.models import BufferChunk, DeviceOperation, TensorComparisonRecord
from ttnn_visualizer.queries import DatabaseQueries, LocalQueryRunner


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
        with self.assertRaises(ProfilerReportNotLoadedException) as context:
            DatabaseQueries(instance=mock_instance)
        self.assertEqual(
            str(context.exception), ProfilerReportNotLoadedException.DEFAULT_MESSAGE
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

    def test_query_operations_ignores_unknown_extra_columns(self):
        """Forward-compatible with TTNN adding columns to report tables."""
        self.connection.execute(
            "ALTER TABLE operations ADD COLUMN future_meta TEXT DEFAULT NULL"
        )
        self.connection.execute(
            "INSERT INTO operations (operation_id, name, duration, future_meta) "
            "VALUES (1, 'op1', 2.0, 'ignored')"
        )
        results = list(self.db_queries.query_operations(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].name, "op1")

    def test_query_buffers(self):
        self.connection.execute("INSERT INTO buffers VALUES (1, 1, 100, 1024, 0)")
        results = list(self.db_queries.query_buffers(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].address, 100)

    def test_query_buffers_ignores_unknown_extra_columns(self):
        self.connection.execute(
            "ALTER TABLE buffers ADD COLUMN extra_note TEXT DEFAULT NULL"
        )
        self.connection.execute(
            "INSERT INTO buffers (operation_id, device_id, address, max_size_per_bank, "
            "buffer_type, extra_note) VALUES (1, 1, 100, 1024, 0, 'note')"
        )
        results = list(self.db_queries.query_buffers(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].address, 100)

    def test_query_stack_traces(self):
        self.connection.execute("INSERT INTO stack_traces VALUES (1, 'trace_data')")
        results = list(self.db_queries.query_stack_traces(filters={"operation_id": 1}))
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].stack_trace, "trace_data")

    def test_query_source_files(self):
        self.connection.executescript("""
            CREATE TABLE source_files (
                id int PRIMARY KEY,
                path text,
                contents text
            );
            INSERT INTO source_files VALUES (1, '/a.py', 'contents');
            """)
        results = list(self.db_queries.query_source_files())
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].contents, "contents")

    def test_get_source_file_by_id_and_path(self):
        self.connection.executescript("""
            CREATE TABLE source_files (
                id int PRIMARY KEY,
                path text,
                contents text
            );
            INSERT INTO source_files VALUES (5, '/b.py', 'body');
            """)
        by_id = self.db_queries.get_source_file_by_id(5)
        self.assertIsNotNone(by_id)
        self.assertEqual(by_id.path, "/b.py")
        by_path = self.db_queries.get_source_file_by_path("/b.py")
        self.assertEqual(by_path.id, 5)

    def test_get_source_file_path_if_present(self):
        self.connection.executescript("""
            CREATE TABLE source_files (
                id int PRIMARY KEY,
                path text,
                contents text
            );
            INSERT INTO source_files VALUES (1, '/has.py', 'body');
            INSERT INTO source_files VALUES (2, '/empty.py', '');
            INSERT INTO source_files VALUES (3, '/null.py', NULL);
            """)
        self.assertEqual(
            self.db_queries.get_source_file_path_if_present(source_file_id=1),
            "/has.py",
        )
        self.assertEqual(
            self.db_queries.get_source_file_path_if_present(file_path="/has.py"),
            "/has.py",
        )
        self.assertIsNone(
            self.db_queries.get_source_file_path_if_present(source_file_id=2)
        )
        self.assertIsNone(
            self.db_queries.get_source_file_path_if_present(source_file_id=3)
        )
        self.assertIsNone(
            self.db_queries.get_source_file_path_if_present(source_file_id=999)
        )
        self.assertIsNone(self.db_queries.get_source_file_path_if_present())
        # When source_file_id misses and file_path is also supplied, the
        # implementation must fall through to the path branch.
        self.assertEqual(
            self.db_queries.get_source_file_path_if_present(
                source_file_id=999, file_path="/has.py"
            ),
            "/has.py",
        )

    def test_query_tensor_comparisons(self):
        self.connection.execute("""
            INSERT INTO local_tensor_comparison_records
            (tensor_id, golden_tensor_id, matches, desired_pcc, actual_pcc)
            VALUES (1, 10, 1, 0.9, 0.8)
            """)
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

    def test_buffer_chunks_source_table_prefers_legacy_when_no_new_table(self):
        self.assertEqual(self.db_queries.buffer_chunks_source_table(), "buffer_pages")

    def test_query_buffer_chunks_aggregates_legacy_buffer_pages(self):
        # Two pages on bank 1 / (0,0) at address 100, contiguous: 1000..1024 and 1024..1048.
        # One page on bank 2 / (1,0) at address 200.
        self.connection.executemany(
            "INSERT INTO buffer_pages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            [
                (1, 0, 100, 0, 0, 1, 0, 1000, 24, 0),
                (1, 0, 100, 0, 0, 1, 1, 1024, 24, 0),
                (1, 0, 200, 0, 1, 2, 0, 2000, 16, 1),
                # Different op_id should not bleed into the op_id=1 group.
                (2, 0, 100, 0, 0, 1, 0, 5000, 8, 0),
            ],
        )

        chunks = sorted(
            self.db_queries.query_buffer_chunks(filters={"operation_id": 1}),
            key=lambda c: (c.address, c.bank_id),
        )

        self.assertEqual(len(chunks), 2)

        first, second = chunks
        self.assertEqual(first.address, 100)
        self.assertEqual(first.bank_id, 1)
        self.assertEqual(first.core_x, 0)
        self.assertEqual(first.core_y, 0)
        self.assertEqual(first.chunk_address, 1000)
        # max(page_address + page_size) - min(page_address) = (1024+24) - 1000 = 48
        self.assertEqual(first.chunk_size, 48)
        self.assertEqual(first.page_size, 24)
        self.assertEqual(first.num_pages, 2)

        self.assertEqual(second.address, 200)
        self.assertEqual(second.bank_id, 2)
        self.assertEqual(second.chunk_address, 2000)
        self.assertEqual(second.chunk_size, 16)
        self.assertEqual(second.num_pages, 1)

    def test_query_buffer_chunks_returns_empty_when_no_source_table(self):
        self.connection.execute("DROP TABLE buffer_pages")
        chunks = list(self.db_queries.query_buffer_chunks())
        self.assertEqual(chunks, [])
        self.assertIsNone(self.db_queries.buffer_chunks_source_table())

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
            "INSERT INTO devices VALUES (1, 4, 4, 2, 2, 1024, 4, 256, 0, 0, 1, 2, 4096, 2048, 2048, 2048, 256)"
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


class TestBufferChunksSourceSelection(unittest.TestCase):
    """
    Covers the dispatch in ``query_buffer_chunks`` between the new
    pre-aggregated ``buffer_chunks`` table and the legacy ``buffer_pages``
    fallback.
    """

    def _setup_connection_with_chunks_table(self):
        connection = sqlite3.connect(":memory:")
        connection.executescript("""
            CREATE TABLE buffer_chunks (
                operation_id INTEGER,
                device_id INTEGER,
                address INTEGER,
                bank_id INTEGER,
                core_x INTEGER,
                core_y INTEGER,
                chunk_address INTEGER,
                chunk_size INTEGER,
                page_size INTEGER,
                num_pages INTEGER,
                buffer_type INTEGER,
                rank INTEGER DEFAULT 0
            );
            """)
        return connection

    def test_prefers_buffer_chunks_when_present(self):
        connection = self._setup_connection_with_chunks_table()
        # Also create buffer_pages with bogus content; we must NOT read it.
        connection.executescript("""
            CREATE TABLE buffer_pages (
                operation_id INTEGER, device_id INTEGER, address INTEGER,
                core_y INTEGER, core_x INTEGER, bank_id INTEGER,
                page_index INTEGER, page_address INTEGER, page_size INTEGER,
                buffer_type INTEGER
            );
            """)
        connection.execute(
            "INSERT INTO buffer_pages VALUES (99, 99, 999, 9, 9, 9, 0, 99999, 99999, 0)"
        )
        connection.execute(
            "INSERT INTO buffer_chunks "
            "(operation_id, device_id, address, bank_id, core_x, core_y, "
            "chunk_address, chunk_size, page_size, num_pages, buffer_type, rank) "
            "VALUES (1, 0, 100, 1, 0, 0, 1000, 48, 24, 2, 0, 0)"
        )

        db = DatabaseQueries(connection=connection)
        self.assertEqual(db.buffer_chunks_source_table(), "buffer_chunks")

        chunks = list(db.query_buffer_chunks(filters={"operation_id": 1}))
        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertIsInstance(chunk, BufferChunk)
        self.assertEqual(chunk.address, 100)
        self.assertEqual(chunk.chunk_size, 48)
        self.assertEqual(chunk.num_pages, 2)
        # Verify nothing leaked from buffer_pages.
        self.assertNotEqual(chunk.address, 999)
        connection.close()

    def test_falls_back_to_buffer_pages_aggregation(self):
        connection = sqlite3.connect(":memory:")
        connection.executescript("""
            CREATE TABLE buffer_pages (
                operation_id INTEGER, device_id INTEGER, address INTEGER,
                core_y INTEGER, core_x INTEGER, bank_id INTEGER,
                page_index INTEGER, page_address INTEGER, page_size INTEGER,
                buffer_type INTEGER
            );
            """)
        connection.execute(
            "INSERT INTO buffer_pages VALUES (1, 0, 100, 0, 0, 1, 0, 1000, 24, 0)"
        )

        db = DatabaseQueries(connection=connection)
        self.assertEqual(db.buffer_chunks_source_table(), "buffer_pages")

        chunks = list(db.query_buffer_chunks(filters={"operation_id": 1}))
        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].chunk_size, 24)
        self.assertEqual(chunks[0].num_pages, 1)
        connection.close()


if __name__ == "__main__":
    unittest.main()
