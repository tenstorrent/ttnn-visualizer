# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A signpost range tt-perf-report cannot honour is refused, not answered.

`filter_by_signpost` only warns about a name it cannot find, then reports some other
window: the rows after the last signpost when neither name matched, or a one-sided
range when one did. An end before the start returns no rows. The perf report route
used to pass those straight through with a 200.
"""

import csv
from pathlib import Path
from unittest import mock

import pandas as pd
import pytest
from tt_perf_report import perf_report
from ttnn_visualizer.csv_queries import (
    MAX_LISTED_SIGNPOSTS,
    check_signpost_range,
)
from ttnn_visualizer.exceptions import InvalidSignpostRange
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable

REPORT_ENDPOINT = "/api/performance/perf-results/report"
SMOKE_CAPTURE = (
    Path(__file__).resolve().parents[3]
    / "scripts"
    / "fixtures"
    / "smoke-performance-report"
    / "ops_perf_results.csv"
)

# Both names repeat, as per-iteration signposts do. Positions are data rows from 0:
# A at 0 and 4, B at 2 and 6.
REPEATED = [
    ("signpost", "A"),
    ("tt_dnn_device", "x"),
    ("signpost", "B"),
    ("tt_dnn_device", "y"),
    ("signpost", "A"),
    ("tt_dnn_device", "z"),
    ("signpost", "B"),
]


def _raw_csv(rows) -> str:
    return "\n".join(["OP TYPE,OP CODE", *(",".join(row) for row in rows), ""])


def _window(rows, start, end):
    """The positions tt-perf-report itself keeps, with signposts printed."""
    frame = pd.DataFrame(rows, columns=["OP TYPE", "OP CODE"])
    return list(perf_report.filter_by_signpost(frame, start, end, False, True).index)


class TestCheckSignpostRange:
    @pytest.mark.parametrize(
        "start, end, window",
        [
            ("A", "B", [1]),
            # One name for both bounds ends at its second occurrence.
            ("A", "A", [1, 2, 3]),
            ("A", None, [1, 2, 3, 4, 5, 6]),
            (None, "B", [0, 1]),
        ],
    )
    def test_an_accepted_range_is_the_first_occurrence_window(self, start, end, window):
        """Pins the semantics the check assumes against the library itself."""
        check_signpost_range(_raw_csv(REPEATED), start, end)

        assert _window(REPEATED, start, end) == window

    def test_no_range_is_not_checked(self):
        check_signpost_range("not,a\ncsv", None, None)
        check_signpost_range("not,a\ncsv", "", "")

    def test_an_absent_name_is_refused_with_the_names_held(self):
        with pytest.raises(
            InvalidSignpostRange, match="no signpost named 'C'"
        ) as raised:
            check_signpost_range(_raw_csv(REPEATED), "C", "B")

        assert "'A', 'B'" in str(raised.value)
        # What it guards against: tt-perf-report applies the bound it found and
        # quietly drops the other.
        assert _window(REPEATED, "C", "B") == [0, 1]

    def test_an_absent_end_is_refused_too(self):
        with pytest.raises(InvalidSignpostRange, match="no signpost named 'C'"):
            check_signpost_range(_raw_csv(REPEATED), "A", "C")

    def test_a_report_without_signposts_says_so(self):
        rows = [("tt_dnn_device", "x")]

        with pytest.raises(InvalidSignpostRange, match="has no signposts"):
            check_signpost_range(_raw_csv(rows), "A", None)

    def test_a_long_list_of_names_is_capped(self):
        rows = [("signpost", f"S{index}") for index in range(MAX_LISTED_SIGNPOSTS + 3)]

        with pytest.raises(InvalidSignpostRange, match="and 3 more") as raised:
            check_signpost_range(_raw_csv(rows), "missing", None)

        assert f"'S{MAX_LISTED_SIGNPOSTS}'" not in str(raised.value)

    def test_one_name_for_both_bounds_needs_two_occurrences(self):
        rows = [("signpost", "A"), ("tt_dnn_device", "x")]

        with pytest.raises(InvalidSignpostRange, match="occurs once"):
            check_signpost_range(_raw_csv(rows), "A", "A")

    def test_an_end_before_the_start_is_refused_with_both_ids(self):
        # B first occurs at position 2 (id 4), A at 0 (id 2), so B..A is empty --
        # even though a later A follows the first B.
        with pytest.raises(InvalidSignpostRange, match="at id 2.*at id 4") as raised:
            check_signpost_range(_raw_csv(REPEATED), "B", "A")

        assert "'A' first occurs at id 2" in str(raised.value)
        assert _window(REPEATED, "B", "A") == []


@pytest.fixture
def signposted_instance(app, tmp_path):
    """An instance whose perf CSV is the smoke capture with two signposts inserted."""
    if not SMOKE_CAPTURE.is_file():
        pytest.skip(f"{SMOKE_CAPTURE} is not present")
    rows = list(csv.DictReader(SMOKE_CAPTURE.open()))

    def signpost(name, like):
        return {**like, "OP CODE": name, "OP TYPE": "signpost"}

    # Data positions after insertion: START at 4, END at 13, so the window holds
    # positions 5-12 -- ids 7-14.
    rows.insert(4, signpost("PERF_START", rows[4]))
    rows.insert(13, signpost("PERF_END", rows[13]))

    performance_path = tmp_path / "performance-report"
    performance_path.mkdir()
    with (performance_path / "ops_perf_results.csv").open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

    instance_id = "pytest-signpost-range"
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


class TestReportRoute:
    def _get(self, client, instance_id, **signposts):
        return client.get(
            REPORT_ENDPOINT,
            query_string={
                "instanceId": instance_id,
                "hide_host_ops": "false",
                **signposts,
            },
        )

    def test_a_valid_range_narrows_the_report(self, client, signposted_instance):
        whole = self._get(client, signposted_instance)
        ranged = self._get(
            client,
            signposted_instance,
            start_signpost="PERF_START",
            end_signpost="PERF_END",
        )

        assert whole.status_code == ranged.status_code == 200
        ranged_ids = {int(row["id"]) for row in ranged.get_json()["report"]}
        whole_ids = {int(row["id"]) for row in whole.get_json()["report"]}
        assert ranged_ids
        assert ranged_ids <= set(range(7, 15))
        assert whole_ids - set(range(7, 15))

    @pytest.mark.parametrize(
        "signposts, message",
        [
            ({"start_signpost": "PERF_STRAT"}, "no signpost named 'PERF_STRAT'"),
            (
                {"start_signpost": "PERF_START", "end_signpost": "PERF_ED"},
                "no signpost named 'PERF_ED'",
            ),
            (
                {"start_signpost": "PERF_END", "end_signpost": "PERF_START"},
                "before start signpost",
            ),
            (
                {"start_signpost": "PERF_START", "end_signpost": "PERF_START"},
                "occurs once",
            ),
        ],
    )
    def test_a_range_it_cannot_honour_is_a_bad_request(
        self, client, signposted_instance, signposts, message
    ):
        with mock.patch(
            "ttnn_visualizer.csv_queries.perf_report.generate_perf_report"
        ) as generate:
            response = self._get(client, signposted_instance, **signposts)

        assert response.status_code == 400
        assert message in response.get_json()["error"]
        generate.assert_not_called()
