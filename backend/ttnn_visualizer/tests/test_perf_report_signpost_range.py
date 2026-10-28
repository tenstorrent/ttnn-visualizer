# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""A signpost range tt-perf-report cannot honour is refused, not answered.

`filter_by_signpost` only warns about a name it cannot find, then reports some other
window: the rows after the last signpost when neither name matched, or a one-sided
range when one did. An end before the start returns no rows. The perf report route
used to pass those straight through with a 200.
"""

import warnings
from http import HTTPStatus
from io import StringIO
from unittest import mock

import pandas as pd
import pytest
from tt_perf_report import perf_report
from ttnn_visualizer.csv_queries import (
    MAX_LISTED_SIGNPOSTS,
    check_signpost_range,
    resolve_signposts,
    signpost_range_ignored,
)
from ttnn_visualizer.exceptions import InvalidSignpostRange
from ttnn_visualizer.extensions import db
from ttnn_visualizer.models import InstanceTable
from ttnn_visualizer.tests.smoke_capture import (
    SIGNPOSTED_WINDOW_IDS,
    signpost,
    signposted_rows,
    smoke_rows,
    write_ops_perf,
)

REPORT_ENDPOINT = "/api/performance/perf-results/report"

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

    def test_a_range_on_a_report_without_signposts_is_answered_whole(self):
        """tt-perf-report uses the whole file here, and says so: no other window."""
        resolved = _resolved([("tt_dnn_device", "x")])

        check_signpost_range(resolved, "A", "B")

        assert signpost_range_ignored(resolved, "A", "B")
        assert not signpost_range_ignored(resolved, None, None)
        assert not signpost_range_ignored(_resolved(REPEATED), "A", "B")

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

        check_signpost_range(resolved, "A", None)

        assert signpost_range_ignored(resolved, "A", None)

    def test_a_nameless_signpost_is_not_offered(self):
        resolved = _resolved([("signpost", "A"), ("signpost", ""), ("x", "y")])

        assert resolved.listing() == [{"id": 2, "op_code": "A"}]


@pytest.mark.parametrize("tracing_mode", [False, True])
def test_a_chunked_parse_resolves_the_same_positions(tracing_mode):
    """`low_memory`, which the agent reads with: ties in host time included."""
    tied = [
        ("signpost", "A", "10"),
        ("tt_dnn_device", "x", "10"),
        ("signpost", "B", "10"),
        ("signpost", "A", "5"),
    ]
    for rows in (REPEATED, HOST_TIME_REVERSED, tied):
        raw = _raw_csv(rows)

        chunked = resolve_signposts(StringIO(raw), tracing_mode, low_memory=True)

        assert chunked == resolve_signposts(StringIO(raw), tracing_mode)


# pandas sizes a chunk by row count from the table's width; 61 more columns make it 8,192
# rows, as a real capture's hundred-odd columns do, so these rows span two chunks.
FILLER_COLUMNS = 61
CHUNKED_ROW_COUNT = 12_000


def _wide_csv(odd_host_time=None, odd_device_id=None):
    """Eight devices' rows, with an odd value past the first chunk if asked for."""
    filler = "," * FILLER_COLUMNS
    header = "OP TYPE,OP CODE,HOST START TS,DEVICE ID" + "".join(
        f",F{index}" for index in range(FILLER_COLUMNS)
    )
    lines = [header]
    for index in range(CHUNKED_ROW_COUNT):
        op_type, op_code, host_start = "tt_dnn_device", "x", str(index)
        device_id = str(index % 8)
        if index in (10, CHUNKED_ROW_COUNT - 10):
            op_type, op_code = "signpost", "START" if index == 10 else "END"
        if odd_host_time is not None and index == CHUNKED_ROW_COUNT - 100:
            host_start = odd_host_time
        if odd_device_id is not None and index == CHUNKED_ROW_COUNT - 50:
            device_id = odd_device_id
        lines.append(f"{op_type},{op_code},{host_start},{device_id}{filler}")
    return "\n".join(lines) + "\n"


@pytest.mark.parametrize(
    "odd, device_count",
    [
        ({}, 8),
        ({"odd_host_time": "oops"}, 8),
        # The whole-file parse keeps the column as text: "0" to "7", and "host",
        # which tt-perf-report does not read as a device, so neither does the count.
        # Not "N/A", which pandas reads as missing in every chunk alike.
        ({"odd_device_id": "host"}, 8),
    ],
)
def test_a_chunked_parse_types_each_column_as_the_whole_file_does(odd, device_count):
    """A chunk holding one non-numeric host time typed the column apart from the
    rest, and sorting the mix raised `TypeError` where the whole-file parse sorts;
    `nunique` counted one chunk's 1 and another's "1" apart."""
    raw = _wide_csv(**odd)

    chunked = resolve_signposts(StringIO(raw), low_memory=True)

    assert chunked == resolve_signposts(StringIO(raw))
    assert set(chunked.positions_by_name) == {"START", "END"}
    assert chunked.device_count == device_count


@pytest.mark.parametrize(
    "odd, column",
    [
        ({"odd_host_time": "oops"}, "HOST START TS"),
        ({"odd_device_id": "host"}, "DEVICE ID"),
    ],
)
def test_the_wide_csv_spans_chunks_that_type_its_odd_column_apart(odd, column):
    """The premise of the tests around it, which would pass without reaching the
    re-read if pandas sized its chunks differently."""
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", pd.errors.DtypeWarning)
        rows = pd.read_csv(StringIO(_wide_csv(**odd)), low_memory=True)

    assert pd.api.types.infer_dtype(rows[column], skipna=True).startswith("mixed")


@pytest.mark.parametrize(
    "odd, read_again",
    [
        ({}, []),
        ({"odd_host_time": "oops"}, ["HOST START TS"]),
        ({"odd_device_id": "host"}, ["DEVICE ID"]),
    ],
)
def test_only_a_column_typed_apart_is_read_again_and_in_chunks(odd, read_again):
    """A whole-file re-read brought back the peak `low_memory` is there to avoid."""
    raw = _wide_csv(**odd)
    header = raw.split("\n", 1)[0].split(",")

    with mock.patch.object(pd, "read_csv", wraps=pd.read_csv) as read:
        resolve_signposts(StringIO(raw), low_memory=True)

    calls = read.call_args_list
    assert [call.kwargs["low_memory"] for call in calls] == [True] * (
        1 + len(read_again)
    )
    assert [
        [name for name in header if call.kwargs["usecols"](name)] for call in calls[1:]
    ] == [[name] for name in read_again]
    assert all(call.kwargs["dtype"] is str for call in calls[1:])


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
    write_ops_perf(performance_path, rows)

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
def unsignposted_instance(app, tmp_path):
    """The smoke capture as it is: no signposts at all."""
    return _write_capture(app, tmp_path, smoke_rows(), "pytest-signpost-none")


@pytest.fixture
def signposted_instance(app, tmp_path):
    """The smoke capture with two signposts bounding `SIGNPOSTED_WINDOW_IDS`."""
    return _write_capture(app, tmp_path, signposted_rows(), "pytest-signpost-range")


@pytest.fixture
def host_time_reversed_instance(app, tmp_path):
    """The smoke capture with PERF_START twice, its later row the earlier by host time.

    Positions: PERF_START at 4, PERF_END at 13, PERF_START again at 15. Sorted by
    host time the start is position 15, after the end; in file order it is 4.
    """
    rows = smoke_rows()
    host_starts = [int(row["HOST START TS"]) for row in rows]
    rows.insert(4, signpost("PERF_START", rows[4], max(host_starts) + 1000))
    rows.insert(13, signpost("PERF_END", rows[13]))
    rows.insert(15, signpost("PERF_START", rows[15], min(host_starts) - 1000))
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
        window = set(SIGNPOSTED_WINDOW_IDS)
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
        assert ranged_ids <= set(SIGNPOSTED_WINDOW_IDS)

    def test_the_listed_signposts_are_the_rows_a_bound_resolves_to(
        self, client, host_time_reversed_instance
    ):
        response = self._get(client, host_time_reversed_instance)

        assert response.status_code == HTTPStatus.OK
        assert response.get_json()["signposts"] == [
            {"id": 15, "op_code": "PERF_END"},
            {"id": 17, "op_code": "PERF_START"},
        ]

    @pytest.mark.parametrize(
        "signposts", [{}, {"start_signpost": "A"}], ids=["no range", "a range"]
    )
    def test_a_capture_the_signpost_read_cannot_parse_is_unprocessable(
        self, app, client, tmp_path, signposts
    ):
        """A CSV pandas cannot tokenise is the caller's data: a 422, not a 500.

        An unterminated quote fails the signpost read itself. A merely ragged row
        would not: the read keeps three columns and tolerates the extra field, so the
        422 would come from tt-perf-report and this would pass without the handling.
        """
        performance_path = tmp_path / "unterminated"
        performance_path.mkdir()
        (performance_path / "ops_perf_results.csv").write_text(
            'OP TYPE,OP CODE\nsignpost,"A\n'
        )
        with app.app_context():
            db.session.add(
                InstanceTable(
                    instance_id="pytest-signpost-unterminated",
                    active_report={},
                    performance_path=str(performance_path),
                )
            )
            db.session.commit()

        with mock.patch(
            "ttnn_visualizer.csv_queries.perf_report.generate_perf_report"
        ) as generate:
            response = self._get(client, "pytest-signpost-unterminated", **signposts)

        assert response.status_code == HTTPStatus.UNPROCESSABLE_ENTITY
        assert "could not read the report's signposts" in response.get_json()["error"]
        generate.assert_not_called()

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

    def test_a_range_on_a_report_without_signposts_is_the_whole_report_flagged(
        self, client, unsignposted_instance
    ):
        """Answered whole, as tt-perf-report answers it, and flagged as not narrowed."""
        whole = self._get(client, unsignposted_instance)
        ranged = self._get(
            client,
            unsignposted_instance,
            start_signpost="PERF_DECODE",
            end_signpost="PERF_DECODE_END",
        )

        assert whole.status_code == ranged.status_code == HTTPStatus.OK
        assert [row["id"] for row in ranged.get_json()["report"]] == [
            row["id"] for row in whole.get_json()["report"]
        ]
        assert ranged.get_json()["signpost_range_ignored"] is True
        assert whole.get_json()["signpost_range_ignored"] is False

    def test_a_narrowed_report_is_not_flagged(self, client, signposted_instance):
        ranged = self._get(
            client,
            signposted_instance,
            start_signpost="PERF_START",
            end_signpost="PERF_END",
        )

        assert ranged.status_code == HTTPStatus.OK
        assert ranged.get_json()["signpost_range_ignored"] is False
