# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import unittest
from unittest.mock import Mock, patch

from flask import Flask
from ttnn_visualizer.models import Instance
from ttnn_visualizer.views import create_indexes_async


class TestCreateIndexesAsync(unittest.TestCase):
    """Tests for create_indexes_async function"""

    def setUp(self):
        """Set up Flask app context for tests"""
        self.app = Flask(__name__)
        self.app_context = self.app.app_context()
        self.app_context.push()

    def tearDown(self):
        """Clean up Flask app context"""
        self.app_context.pop()

    @patch("ttnn_visualizer.views.ThreadPoolExecutor")
    @patch("ttnn_visualizer.views.copy_current_request_context")
    @patch("ttnn_visualizer.views.InstanceTable")
    @patch("ttnn_visualizer.views.DatabaseQueries")
    def test_create_indexes_async_with_instance_id(
        self, mock_db_queries, mock_instance_table, mock_copy_context, mock_executor
    ):
        """Test that create_indexes_async creates indexes when instance_id is provided"""
        # Mock copy_current_request_context to be a no-op decorator
        mock_copy_context.side_effect = lambda f: f

        # Mock InstanceTable.query.filter_by().first() to return a mock instance
        mock_instance_data = Mock()
        mock_instance_data.to_pydantic.return_value = Instance(
            instance_id="test_instance", profiler_path="/path/to/db.sqlite"
        )
        mock_query = Mock()
        mock_query.filter_by.return_value.first.return_value = mock_instance_data
        mock_instance_table.query = mock_query

        # Mock DatabaseQueries context manager
        mock_db = Mock()
        mock_db_queries.return_value.__enter__.return_value = mock_db
        mock_db_queries.return_value.__exit__.return_value = None

        # Mock ThreadPoolExecutor
        mock_executor_instance = Mock()
        mock_executor.return_value = mock_executor_instance

        # Call the function
        create_indexes_async("/path/to/db.sqlite", "test_instance_id")

        # Verify ThreadPoolExecutor was created and submit was called
        mock_executor.assert_called_once_with(max_workers=1)
        mock_executor_instance.submit.assert_called_once()
        mock_executor_instance.shutdown.assert_called_once_with(wait=False)

        # Get the submitted function and call it to verify it works
        submitted_func = mock_executor_instance.submit.call_args[0][0]

        # Call the submitted function to verify it calls create_indexes
        submitted_func()

        # Verify DatabaseQueries was called with the instance
        mock_db_queries.assert_called_once()
        call_args = mock_db_queries.call_args[0][0]
        self.assertEqual(call_args.instance_id, "test_instance")
        self.assertEqual(call_args.profiler_path, "/path/to/db.sqlite")

        # Verify create_indexes was called
        mock_db.create_indexes.assert_called_once()

    @patch("ttnn_visualizer.views.ThreadPoolExecutor")
    @patch("ttnn_visualizer.views.copy_current_request_context")
    @patch("ttnn_visualizer.views.DatabaseQueries")
    def test_create_indexes_async_without_instance_id(
        self, mock_db_queries, mock_copy_context, mock_executor
    ):
        """Test that create_indexes_async creates indexes when instance_id is not provided"""
        # Mock copy_current_request_context to be a no-op decorator
        mock_copy_context.side_effect = lambda f: f

        # Mock DatabaseQueries context manager
        mock_db = Mock()
        mock_db_queries.return_value.__enter__.return_value = mock_db
        mock_db_queries.return_value.__exit__.return_value = None

        # Mock ThreadPoolExecutor
        mock_executor_instance = Mock()
        mock_executor.return_value = mock_executor_instance

        # Call the function without instance_id
        create_indexes_async("/path/to/db.sqlite")

        # Verify ThreadPoolExecutor was created and submit was called
        mock_executor.assert_called_once_with(max_workers=1)
        mock_executor_instance.submit.assert_called_once()

        # Get the submitted function and call it to verify it works
        submitted_func = mock_executor_instance.submit.call_args[0][0]

        # Call the submitted function to verify it calls create_indexes
        submitted_func()

        # Verify DatabaseQueries was called with a temporary instance
        mock_db_queries.assert_called_once()
        call_args = mock_db_queries.call_args[0][0]
        self.assertEqual(call_args.instance_id, "")
        self.assertEqual(call_args.profiler_path, "/path/to/db.sqlite")

        # Verify create_indexes was called
        mock_db.create_indexes.assert_called_once()
