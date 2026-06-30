# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Tests that the per-RISC kernel durations from the raw ops perf CSV are surfaced on
the generated perf report rows (#1518)."""

import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

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

REPORT_HEADER = [
    "id",
    "total_percent",
    "bound",
    "op_code",
    "device",
    "device_time",
    "op_to_op_gap",
    "cores",
    "dram",
    "dram_percent",
    "flops",
    "flops_percent",
    "math_fidelity",
    "output_datatype",
    "input_0_datatype",
    "input_1_datatype",
    "dram_sharded",
    "input_0_memory",
    "inner_dim_block_size",
    "output_subblock_h",
    "output_subblock_w",
    "global_call_count",
    "advice",
    "raw_op_code",
]


@unittest.skipUnless(DEMO_REPORT.exists(), "n300-llama demo report not available")
class TestPerfReportKernelDurations(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._tmp = tempfile.TemporaryDirectory()
        with zipfile.ZipFile(DEMO_REPORT) as archive:
            archive.extractall(cls._tmp.name)

        # The ops perf CSV lives under local/performance-reports/<REPORT_NAME>/
        perf_csv = next(Path(cls._tmp.name).rglob("ops_perf_results*.csv"), None)
        if perf_csv is None:
            raise unittest.SkipTest(
                "ops_perf_results*.csv not found in n300-llama demo report; "
                "demo-report packaging may have changed"
            )
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


class TestPerfReportKernelDurationSchemaCompatibility(unittest.TestCase):
    def test_raw_csv_kernel_durations_are_passed_through(self):
        # tt-perf-report output omits these columns, but the raw source CSV contains them.
        raw_csv = "\n".join(
            [
                "OP TYPE,OP CODE,DEVICE KERNEL DURATION [ns],DEVICE BRISC KERNEL DURATION [ns],DEVICE NCRISC KERNEL DURATION [ns],DEVICE TRISC0 KERNEL DURATION [ns],DEVICE TRISC1 KERNEL DURATION [ns],DEVICE TRISC2 KERNEL DURATION [ns],DEVICE ERISC KERNEL DURATION [ns]",
                "device_op,Matmul,1200,1100,1000,900,800,700,600",
                "",
            ]
        )

        def _fake_generate_perf_report(*args, **kwargs):
            output_csv_path = args[8]

            with open(
                output_csv_path, "w", encoding="utf-8", newline=""
            ) as output_file:
                output_file.write(",".join(REPORT_HEADER) + "\n")
                output_file.write(
                    ",".join(
                        [
                            "2",
                            "1.0",
                            "DRAM",
                            "Matmul",
                            "0",
                            "10.0",
                            "1.0",
                            "64",
                            "100.0",
                            "50.0",
                            "200.0",
                            "50.0",
                            "HiFi4",
                            "BFLOAT16",
                            "BFLOAT16",
                            "BFLOAT16",
                            "False",
                            "DRAM",
                            "",
                            "",
                            "",
                            "1",
                            "",
                            "Matmul",
                        ]
                    )
                    + "\n"
                )

        instance = Instance(instance_id="test", performance_path="/tmp")

        with (
            mock.patch(
                "ttnn_visualizer.csv_queries.OpsPerformanceQueries.get_raw_csv",
                return_value=raw_csv,
            ),
            mock.patch(
                "ttnn_visualizer.csv_queries.perf_report.generate_perf_report",
                side_effect=_fake_generate_perf_report,
            ),
        ):
            report = OpsPerformanceReportQueries.generate_report(instance)["report"]

        self.assertEqual(len(report), 1)
        expected = {
            "device_kernel_duration": "1200",
            "brisc_kernel_duration": "1100",
            "ncrisc_kernel_duration": "1000",
            "trisc0_kernel_duration": "900",
            "trisc1_kernel_duration": "800",
            "trisc2_kernel_duration": "700",
            "erisc_kernel_duration": "600",
        }

        for key, value in expected.items():
            self.assertIn(key, report[0])
            self.assertEqual(report[0][key], value)


if __name__ == "__main__":
    unittest.main()
