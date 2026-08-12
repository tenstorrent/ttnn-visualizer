# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The boolean query params on the perf report endpoint are a public HTTP surface.

They are read through ``str_to_bool``, so they inherit whatever vocabulary config
settles on — and a value that stops being recognised doesn't error, it flips the
report. ``?hide_host_ops=t`` used to hide host ops; narrowing the vocabulary made the
same request show them. The app's own client sends axios booleans, so nothing in-tree
notices; these tests are what a scripted caller has instead.
"""

import pytest
from ttnn_visualizer.csv_queries import OpsPerformanceReportQueries
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

REPORT_ENDPOINT = "/api/performance/perf-results/report"

# Defaults come from the view, so each is exercised against the value it isn't.
BOOLEAN_PARAMS = {
    "print_signposts": True,
    "hide_host_ops": True,
    "merge_devices": True,
    "tracing_mode": False,
}


@pytest.fixture
def performance_instance(app, tmp_path):
    """An instance with a performance report mounted, which the route requires."""
    instance_id = "pytest-perf-params"
    performance_path = tmp_path / "performance-report"
    performance_path.mkdir()

    with app.app_context():
        db.session.add(
            InstanceTable(
                instance_id=instance_id,
                active_report={},
                performance_path=str(performance_path),
            )
        )
        db.session.commit()

    return instance_id


@pytest.fixture
def captured_report_kwargs(monkeypatch):
    """Capture what the view passes on, rather than generating a report from fixtures.

    The parsing is the contract under test; whether tt-perf-report then produces the
    right rows is ``test_perf_report.py``'s job.
    """
    captured = {}

    def _fake_generate_report(instance, **kwargs):
        captured.update(kwargs)
        return {"report": []}

    monkeypatch.setattr(
        OpsPerformanceReportQueries,
        "generate_report",
        staticmethod(_fake_generate_report),
    )

    return captured


@pytest.mark.parametrize("param", sorted(BOOLEAN_PARAMS))
@pytest.mark.parametrize(
    "value, expected",
    [("true", True), ("1", True), ("false", False), ("0", False)],
)
def test_the_documented_vocabulary_reaches_the_report(
    param, value, expected, client, performance_instance, captured_report_kwargs
):
    response = client.get(
        REPORT_ENDPOINT,
        query_string={"instanceId": performance_instance, param: value},
    )

    assert response.status_code == 200
    assert captured_report_kwargs[param] is expected


@pytest.mark.parametrize("param, default", sorted(BOOLEAN_PARAMS.items()))
def test_an_omitted_param_keeps_the_view_default(
    param, default, client, performance_instance, captured_report_kwargs
):
    response = client.get(
        REPORT_ENDPOINT, query_string={"instanceId": performance_instance}
    )

    assert response.status_code == 200
    assert captured_report_kwargs[param] is default
