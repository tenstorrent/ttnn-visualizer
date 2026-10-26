# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""tt-perf-report calls ``sys.exit`` on some captures it can't parse, such as an ops
perf CSV with no ``DEVICE ID`` column. Through the report route that exit must come
back as a 422 naming the CSV, not a dropped request or a 500. #2183
"""

from unittest.mock import patch

import pytest
from ttnn_visualizer import csv_queries
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

REPORT_ENDPOINT = "/api/performance/perf-results/report"
INSTANCE_ID = "pytest-perf-exit"
CSV_NAME = "ops_perf_results_missing_device_id.csv"

# tt-perf-report 1.4.0 exits in `merge_perf_traces` when this column is absent.
MISSING_DEVICE_ID_CSV = "OP CODE,OP TYPE,GLOBAL CALL COUNT\nMatmul,tt_dnn_device,1\n"


@pytest.fixture
def missing_device_id_instance(app, tmp_path):
    """An instance whose mounted performance report has no `DEVICE ID` column."""
    performance_path = tmp_path / "performance-report"
    performance_path.mkdir()
    (performance_path / CSV_NAME).write_text(MISSING_DEVICE_ID_CSV, encoding="utf-8")

    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=INSTANCE_ID,
                active_report={},
                performance_path=str(performance_path),
            )
        )
        db.session.commit()

    return INSTANCE_ID


def _exit_from_library_frame(exit_arg):
    """A stand-in for `generate_perf_report` that exits from a frame reporting
    tt-perf-report's own file, since the conversion keys on the innermost frame."""
    namespace = {"exit_arg": exit_arg}
    code = compile(
        "def _exit(*args, **kwargs):\n    raise SystemExit(exit_arg)\n",
        csv_queries.perf_report.__file__,
        "exec",
    )
    exec(code, namespace)
    return namespace["_exit"]


def test_a_real_missing_device_id_exit_is_unprocessable(
    client, tmp_path, missing_device_id_instance
):
    response = client.get(
        REPORT_ENDPOINT, query_string={"instanceId": missing_device_id_instance}
    )

    body = response.get_data(as_text=True)
    assert response.status_code == 422
    assert f"{CSV_NAME} could not be parsed (exit code 1)" in body
    assert str(tmp_path) not in body


@pytest.mark.parametrize(
    ("exit_arg", "expected_suffix"),
    [
        (2, " (exit code 2)"),
        (None, ""),
        ("/secret/internal/path", ""),
        (True, ""),
    ],
)
def test_only_an_integer_exit_code_reaches_the_response(
    client, tmp_path, missing_device_id_instance, exit_arg, expected_suffix
):
    with patch.object(
        csv_queries.perf_report,
        "generate_perf_report",
        side_effect=_exit_from_library_frame(exit_arg),
    ):
        response = client.get(
            REPORT_ENDPOINT, query_string={"instanceId": missing_device_id_instance}
        )

    body = response.get_data(as_text=True)
    assert response.status_code == 422
    assert f"{CSV_NAME} could not be parsed{expected_suffix}" in body
    assert str(tmp_path) not in body
    assert "/secret/internal/path" not in body
