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
from http import HTTPStatus
from io import StringIO
from pathlib import Path
from unittest import mock

import pandas as pd
import pytest
from tt_perf_report import perf_report
from ttnn_visualizer.csv_queries import (
    MAX_LISTED_SIGNPOSTS,
    check_signpost_range,
    resolve_signposts,
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


# Host start times running against file order, so the earliest A by host time is
# its last in the file. Positions: A at 0 and 4, B at 2.
HOST_TIME_REVERSED = [
    ("signpost", "A", "30"),
    ("tt_dnn_device", "x", "25"),
    ("signpost", "B", "20"),
    ("tt_dnn_device", "y", "15"),
    ("signpost", "A", "10"),
]


def _raw_csv(rows) -> str:
    header = "OP TYPE,OP CODE" + (",HOST START TS" if len(rows[0]) == 3 else "")
    return "\n".join([header, *(",".join(row) for row in rows), ""])


def _resolved(rows, tracing_mode=False):
    return resolve_signposts(StringIO(_raw_csv(rows)), tracing_mode)


def _window(rows, start, end, tracing_mode=False):
    """The positions tt-perf-report itself keeps, with signposts printed.

    Sorted first as `generate_perf_report` sorts before it filters, so the window is
    the one the report would hold rather than the filter's alone.
    """
    frame = pd.read_csv(StringIO(_raw_csv(rows)))
    if "HOST START TS" in frame.columns and not tracing_mode:
        frame = frame.sort_values(by="HOST START TS")
    return sorted(perf_report.filter_by_signpost(frame, start, end, False, True).index)


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
        check_signpost_range(_resolved(REPEATED), start, end)

        assert _window(REPEATED, start, end) == window

    def test_no_range_is_not_checked(self):
        nothing = resolve_signposts(StringIO("not,a\ncsv\n"))

        check_signpost_range(nothing, None, None)
        check_signpost_range(nothing, "", "")

    def test_an_absent_name_is_refused_with_the_names_held(self):
        with pytest.raises(
            InvalidSignpostRange, match="no signpost named 'C'"
        ) as raised:
            check_signpost_range(_resolved(REPEATED), "C", "B")

        assert "'A', 'B'" in str(raised.value)
        # What it guards against: tt-perf-report applies the bound it found and
        # quietly drops the other.
        assert _window(REPEATED, "C", "B") == [0, 1]

    def test_an_absent_end_is_refused_too(self):
        with pytest.raises(InvalidSignpostRange, match="no signpost named 'C'"):
            check_signpost_range(_resolved(REPEATED), "A", "C")

    def test_a_report_without_signposts_says_so(self):
        rows = [("tt_dnn_device", "x")]

        with pytest.raises(InvalidSignpostRange, match="has no signposts"):
            check_signpost_range(_resolved(rows), "A", None)

    def test_a_long_list_of_names_is_capped(self):
        rows = [("signpost", f"S{index}") for index in range(MAX_LISTED_SIGNPOSTS + 3)]

        with pytest.raises(InvalidSignpostRange, match="and 3 more") as raised:
            check_signpost_range(_resolved(rows), "missing", None)

        assert f"'S{MAX_LISTED_SIGNPOSTS}'" not in str(raised.value)

    def test_one_name_for_both_bounds_needs_two_occurrences(self):
        rows = [("signpost", "A"), ("tt_dnn_device", "x")]

        with pytest.raises(InvalidSignpostRange, match="occurs once"):
            check_signpost_range(_resolved(rows), "A", "A")

    def test_an_end_before_the_start_is_refused_with_both_ids(self):
        # B first occurs at position 2 (id 4), A at 0 (id 2), so B..A is empty --
        # even though a later A follows the first B.
        with pytest.raises(
            InvalidSignpostRange,
            match="'A' resolves to id 2, before start signpost 'B' at id 4",
        ) as raised:
            check_signpost_range(_resolved(REPEATED), "B", "A")

        assert "first occurrence by file position" in str(raised.value)
        assert _window(REPEATED, "B", "A") == []

    def test_a_bound_is_its_earliest_occurrence_by_host_time(self):
        """tt-perf-report sorts by host start time before it resolves a name.

        By file order A..B is the row between them; by host time A is the last row
        in the file, after B, so the report would hold nothing.
        """
        with pytest.raises(InvalidSignpostRange, match="by host start time"):
            check_signpost_range(_resolved(HOST_TIME_REVERSED), "A", "B")

        assert _window(HOST_TIME_REVERSED, "A", "B") == []

    def test_tracing_mode_resolves_by_file_order(self):
        """Tracing mode leaves the rows unsorted, so the first A in the file counts."""
        check_signpost_range(_resolved(HOST_TIME_REVERSED, tracing_mode=True), "A", "B")

        assert _window(HOST_TIME_REVERSED, "A", "B", tracing_mode=True) == [1]

    def test_one_name_for_both_bounds_resolves_by_host_time_too(self):
        """The earliest A by host time is the later one in the file, so A..A is empty."""
        with pytest.raises(InvalidSignpostRange, match="the end its second"):
            check_signpost_range(_resolved(HOST_TIME_REVERSED), "A", "A")

        assert _window(HOST_TIME_REVERSED, "A", "A") == []

    def test_a_report_without_the_signpost_columns_has_no_signposts(self):
        resolved = resolve_signposts(StringIO("OP CODE,HOST START TS\nx,1\n"))

        with pytest.raises(InvalidSignpostRange, match="has no signposts"):
            check_signpost_range(resolved, "A", None)

    def test_a_nameless_signpost_is_not_offered(self):
        resolved = _resolved([("signpost", "A"), ("signpost", ""), ("x", "y")])

        assert resolved.listing() == [{"id": 2, "op_code": "A"}]


class TestSignpostListing:
    """The `signposts` list is what the app's range picker offers.

    The picker offers as an end only the entries after the chosen start, so the list
    must order names the way a bound resolves them -- or the app builds a range the
    route refuses.
    """

    @pytest.mark.parametrize(
        "rows, tracing_mode",
        [
            (REPEATED, False),
            (HOST_TIME_REVERSED, False),
            (HOST_TIME_REVERSED, True),
        ],
    )
    def test_every_range_the_picker_offers_is_accepted(self, rows, tracing_mode):
        resolved = _resolved(rows, tracing_mode)
        names = [entry["op_code"] for entry in resolved.listing()]

        for index, start in enumerate(names):
            for end in names[index + 1 :]:
                check_signpost_range(resolved, start, end)
            for end in names[:index]:
                with pytest.raises(InvalidSignpostRange, match="before start"):
                    check_signpost_range(resolved, start, end)

    def test_an_entry_is_the_row_a_bound_resolves_to(self):
        # By host time A's earliest row is position 4 (id 6), after B at id 4.
        assert _resolved(HOST_TIME_REVERSED).listing() == [
            {"id": 4, "op_code": "B"},
            {"id": 6, "op_code": "A"},
        ]
        assert _resolved(HOST_TIME_REVERSED, tracing_mode=True).listing() == [
            {"id": 2, "op_code": "A"},
            {"id": 4, "op_code": "B"},
        ]


def _write_capture(app, tmp_path, rows, instance_id) -> str:
    performance_path = tmp_path / instance_id
    performance_path.mkdir()
    with (performance_path / "ops_perf_results.csv").open("w", newline="") as out:
        writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)

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


def _smoke_rows():
    if not SMOKE_CAPTURE.is_file():
        pytest.skip(f"{SMOKE_CAPTURE} is not present")
    return list(csv.DictReader(SMOKE_CAPTURE.open()))


def _signpost(name, like, host_start=None):
    row = {**like, "OP CODE": name, "OP TYPE": "signpost"}
    if host_start is not None:
        row["HOST START TS"] = str(host_start)
    return row


@pytest.fixture
def signposted_instance(app, tmp_path):
    """The smoke capture with two signposts inserted."""
    rows = _smoke_rows()
    # Data positions after insertion: START at 4, END at 13, so the window holds
    # positions 5-12 -- ids 7-14.
    rows.insert(4, _signpost("PERF_START", rows[4]))
    rows.insert(13, _signpost("PERF_END", rows[13]))
    return _write_capture(app, tmp_path, rows, "pytest-signpost-range")


@pytest.fixture
def host_time_reversed_instance(app, tmp_path):
    """The smoke capture with PERF_START twice, its later row the earlier by host time.

    Positions: PERF_START at 4, PERF_END at 13, PERF_START again at 15. Sorted by
    host time the start is position 15, after the end; in file order it is 4.
    """
    rows = _smoke_rows()
    host_starts = [int(row["HOST START TS"]) for row in rows]
    rows.insert(4, _signpost("PERF_START", rows[4], max(host_starts) + 1000))
    rows.insert(13, _signpost("PERF_END", rows[13]))
    rows.insert(15, _signpost("PERF_START", rows[15], min(host_starts) - 1000))
    return _write_capture(app, tmp_path, rows, "pytest-signpost-host-time")


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

        assert whole.status_code == ranged.status_code == HTTPStatus.OK
        ranged_ids = {int(row["id"]) for row in ranged.get_json()["report"]}
        whole_ids = {int(row["id"]) for row in whole.get_json()["report"]}
        window = set(range(7, 15))
        # Every row the whole report holds between the boundaries, and no other:
        # a window one row short or long at either end changes the set.
        assert ranged_ids == whole_ids & window
        assert ranged_ids
        assert whole_ids - window

    @pytest.mark.parametrize(
        "signposts, message",
        [
            ({"start_signpost": "PERF_STRAT"}, "no signpost named 'PERF_STRAT'"),
            ({"end_signpost": "PERF_ED"}, "no signpost named 'PERF_ED'"),
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

        assert response.status_code == HTTPStatus.BAD_REQUEST
        assert message in response.get_json()["error"]
        generate.assert_not_called()

    def test_tracing_mode_decides_which_occurrence_bounds_the_range(
        self, client, host_time_reversed_instance
    ):
        """The route hands tracing mode to the check, as it does to tt-perf-report."""
        sorted_by_host_time = self._get(
            client,
            host_time_reversed_instance,
            start_signpost="PERF_START",
            end_signpost="PERF_END",
            tracing_mode="false",
        )
        unsorted = self._get(
            client,
            host_time_reversed_instance,
            start_signpost="PERF_START",
            end_signpost="PERF_END",
            tracing_mode="true",
        )

        assert sorted_by_host_time.status_code == HTTPStatus.BAD_REQUEST
        assert "by host start time" in sorted_by_host_time.get_json()["error"]
        assert unsorted.status_code == HTTPStatus.OK
        ranged_ids = {int(row["id"]) for row in unsorted.get_json()["report"]}
        assert ranged_ids
        assert ranged_ids <= set(range(7, 15))

    def test_the_listed_signposts_are_the_rows_a_bound_resolves_to(
        self, client, host_time_reversed_instance
    ):
        response = self._get(client, host_time_reversed_instance)

        assert response.status_code == HTTPStatus.OK
        assert response.get_json()["signposts"] == [
            {"id": 15, "op_code": "PERF_END"},
            {"id": 17, "op_code": "PERF_START"},
        ]

    def test_a_capture_it_cannot_parse_is_unprocessable_with_a_range(
        self, app, client, tmp_path
    ):
        """A ragged CSV is the caller's data: a 422, as without a range, not a 500."""
        performance_path = tmp_path / "ragged"
        performance_path.mkdir()
        (performance_path / "ops_perf_results.csv").write_text(
            "OP TYPE,OP CODE\nsignpost,A\nx,y,z,extra\n"
        )
        with app.app_context():
            db.session.add(
                InstanceTable(
                    instance_id="pytest-signpost-ragged",
                    active_report={},
                    performance_path=str(performance_path),
                )
            )
            db.session.commit()

        response = self._get(client, "pytest-signpost-ragged", start_signpost="A")

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY

    def test_tt_perf_report_answers_a_range_only_host_time_order_accepts(
        self, client, host_time_reversed_instance
    ):
        """Pins the premise of the check against the library, not a copy of its sort.

        By host time PERF_START resolves to position 15, after PERF_END at 13, so
        PERF_END..PERF_START holds position 14 (id 16). In file order PERF_START is 4,
        before PERF_END, so tracing mode refuses it. If tt-perf-report stopped sorting
        before it filters, the accepted range would come back without that row.
        """
        signposts = {"start_signpost": "PERF_END", "end_signpost": "PERF_START"}

        sorted_by_host_time = self._get(
            client,
            host_time_reversed_instance,
            tracing_mode="false",
            merge_devices="false",
            **signposts,
        )
        unsorted = self._get(
            client, host_time_reversed_instance, tracing_mode="true", **signposts
        )

        assert sorted_by_host_time.status_code == HTTPStatus.OK
        report = sorted_by_host_time.get_json()["report"]
        assert [int(row["id"]) for row in report] == [16]
        assert unsorted.status_code == HTTPStatus.BAD_REQUEST
        assert "before start signpost" in unsorted.get_json()["error"]
