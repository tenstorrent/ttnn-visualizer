# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import sqlite3
import unittest

from ttnn_visualizer.models import SourceFile
from ttnn_visualizer.queries import DatabaseQueries
from ttnn_visualizer.report_source_file import (
    lookup_report_source_file,
    read_report_source_file,
    report_source_file_available,
)


class TestReportSourceFile(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.executescript("""
            CREATE TABLE source_files (
                id int PRIMARY KEY,
                path text,
                contents text
            );
            INSERT INTO source_files VALUES (1, '/proj/model.py', 'def forward(): pass');
            INSERT INTO source_files VALUES (2, '/proj/other.py', '');
            """)
        self.db = DatabaseQueries(connection=self.connection)

    def tearDown(self):
        self.connection.close()

    def test_lookup_by_id(self):
        row = lookup_report_source_file(self.db, source_file_id=1)
        self.assertIsInstance(row, SourceFile)
        self.assertEqual(row.path, "/proj/model.py")

    def test_lookup_by_id_skips_empty_contents(self):
        self.assertIsNone(lookup_report_source_file(self.db, source_file_id=2))

    def test_lookup_by_path(self):
        row = lookup_report_source_file(self.db, file_path="/proj/model.py")
        self.assertEqual(row.id, 1)

    def test_lookup_by_path_only_without_source_file_id(self):
        row = lookup_report_source_file(
            self.db, source_file_id=None, file_path="/proj/model.py"
        )
        self.assertEqual(row.contents, "def forward(): pass")

    def test_read_report_source_file_by_path_only(self):
        result = read_report_source_file(self.db, file_path="/proj/model.py")
        self.assertEqual(result, ("def forward(): pass", "/proj/model.py"))

    def test_report_source_file_available(self):
        self.assertTrue(report_source_file_available(self.db, source_file_id=1))
        self.assertFalse(report_source_file_available(self.db, file_path="/missing.py"))

    def test_read_report_source_file(self):
        result = read_report_source_file(self.db, source_file_id=1)
        self.assertEqual(result, ("def forward(): pass", "/proj/model.py"))

    def test_availability_does_not_load_contents(self):
        """
        ``report_source_file_available`` is on the hot /test path and must not
        fetch the (potentially large) ``contents`` blob. We assert the dedicated
        lightweight query is used and the contents-loading lookup is bypassed.
        """
        contents_loaded = False

        original_by_id = self.db.get_source_file_by_id

        def _spy(*args, **kwargs):
            nonlocal contents_loaded
            contents_loaded = True
            return original_by_id(*args, **kwargs)

        self.db.get_source_file_by_id = _spy  # type: ignore[assignment]
        try:
            self.assertTrue(report_source_file_available(self.db, source_file_id=1))
        finally:
            self.db.get_source_file_by_id = original_by_id  # type: ignore[assignment]

        self.assertFalse(
            contents_loaded,
            "availability probe must not load source_files.contents",
        )

    def test_read_and_availability_reject_unsafe_db_paths(self):
        """
        DB-stored paths must pass _validate_stack_trace_raw_path before
        becoming ``resolved_path`` in the stack-trace read JSON body. lookup_*
        may still surface the row (it's the SQL layer), but read_* and
        available_* must refuse it so HTTP callers never see it.
        """
        unsafe_cases = [
            (10, "/a/../evil.py"),
            (11, "/proj/x.py\r\nInjected: 1"),
            (12, "/proj/inner\nhead.py"),
            (13, "/proj/\x00.py"),
            (14, "   "),
        ]
        for row_id, bad_path in unsafe_cases:
            self.connection.execute(
                "INSERT INTO source_files VALUES (?, ?, 'body')",
                (row_id, bad_path),
            )
        self.connection.commit()

        for row_id, bad_path in unsafe_cases:
            with self.subTest(bad_path=bad_path):
                self.assertIsNone(
                    read_report_source_file(self.db, source_file_id=row_id)
                )
                self.assertFalse(
                    report_source_file_available(self.db, source_file_id=row_id)
                )
