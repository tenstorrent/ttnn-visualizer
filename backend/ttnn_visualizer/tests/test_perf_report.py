# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""Tests that the per-RISC kernel durations from the raw ops perf CSV are surfaced on
the generated perf report rows (#1518)."""

import tempfile
import unittest
import zipfile
from pathlib import Path

from ttnn_visualizer.csv_queries import OpsPerformanceReportQueries
from ttnn_visualizer.models import Instance

REPO_ROOT = Path(__file__).resolve().parents[3]
DEMO_REPORT = REPO_ROOT / "demo-reports" / "n300-llama.zip"

KERNEL_DURATION_KEYS = [
    "device_kernel_duration",
    "brisc_kernel_duration",
    "ncrisc_kernel_duration",
    "trisc0_kernel_duration",
    "trisc1_kernel_duration",
    "trisc2_kernel_duration",
    "erisc_kernel_duration",
]


@unittest.skipUnless(DEMO_REPORT.exists(), "n300-llama demo report not available")
class TestPerfReportKernelDurations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        with zipfile.ZipFile(DEMO_REPORT) as archive:
            archive.extractall(cls._tmp.name)

        # The ops perf CSV lives under local/performance-reports/<REPORT_NAME>/
        perf_csv = next(Path(cls._tmp.name).rglob("ops_perf_results*.csv"))
        instance = Instance(instance_id="test", performance_path=str(perf_csv.parent))
        cls.report = OpsPerformanceReportQueries.generate_report(instance)["report"]

    @classmethod
    def tearDownClass(cls):
        cls._tmp.cleanup()

    def test_report_is_populated(self):
        self.assertGreater(len(self.report), 0)

    def test_kernel_duration_keys_present_on_every_row(self):
        for row in self.report:
            for key in KERNEL_DURATION_KEYS:
                self.assertIn(key, row)

    def test_device_op_has_per_risc_durations(self):
        # At least one device op should carry a populated BRISC kernel duration.
        device_ops = [
            row
            for row in self.report
            if row.get("brisc_kernel_duration") not in (None, "")
        ]
        self.assertGreater(len(device_ops), 0)

        sample = device_ops[0]
        self.assertGreater(float(sample["brisc_kernel_duration"]), 0)
        self.assertGreater(float(sample["device_kernel_duration"]), 0)

    def test_signpost_rows_have_no_kernel_durations(self):
        signposts = [row for row in self.report if row.get("op_type") == "signpost"]
        for row in signposts:
            self.assertIn(row.get("brisc_kernel_duration"), (None, ""))


if __name__ == "__main__":
    unittest.main()
