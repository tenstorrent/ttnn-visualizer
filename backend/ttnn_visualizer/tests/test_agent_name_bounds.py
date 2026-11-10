# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Every name bound counts the bytes a name takes in an answer, as the answer's budget
does, so a name of wide or escaped characters cannot take more than its share. #2255
"""

import pytest
from ttnn_visualizer.agent import noc_congestion, server, tools
from ttnn_visualizer.agent.bounds import answer_size, name_fits
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.event_logging import McpToolOutcome
from ttnn_visualizer.tests.mcp_calls import tool_call
from ttnn_visualizer.tests.smoke_capture import signpost, smoke_rows, write_ops_perf
from ttnn_visualizer.tests.test_agent_core_spread import _op, _spread, _zone
from ttnn_visualizer.tests.test_agent_perf_detail import ANSWER_BUDGET_BYTES
from ttnn_visualizer.tests.test_agent_tools import _zone_timings
from ttnn_visualizer.tests.test_agent_zone_intervals import _intervals, _run
from ttnn_visualizer.tests.test_device_log_columns import modern_row

# Three bytes each in UTF-8.
WIDE = "€"


def _wide(size: int) -> str:
    """A name of `size` bytes in UTF-8, wide characters but for an ASCII remainder."""
    return WIDE * (size // 3) + "x" * (size % 3)


def test_a_name_is_measured_in_utf8_bytes():
    assert answer_size("abc") == 3
    assert answer_size(WIDE) == 3
    assert answer_size("😀") == 4
    # JSON writes a control character as \u0001, a quote as \", and the wire a lone
    # surrogate as \udcxx.
    assert answer_size("\x01") == 6
    assert answer_size('"') == 2
    assert answer_size("\udc80") == 6
    assert not name_fits("x" * 300, 256)


@pytest.mark.parametrize("name", ["abc", WIDE, "😀", "\x01", '"', "\\", "\udc80", "\n"])
def test_a_name_is_measured_as_the_server_writes_an_answer(name):
    """Pinned to the serialiser itself, so the bounds follow it if it changes."""

    def written(value):
        return len(server._answer_text({"k": value}).encode())

    assert answer_size(name) == written(name) - written("")


@pytest.mark.parametrize("extra, listed", [(0, True), (1, False)])
def test_a_zone_name_is_listed_up_to_the_bound_in_bytes(tmp_path, extra, listed):
    name = _wide(tools.MAX_ZONE_NAME_LENGTH + extra)

    result = _zone_timings(tmp_path, [(name, "BRISC", 900)])

    assert ([zone["zone"] for zone in result["zones"]] == [name]) is listed
    assert result.get("zones_unlisted_too_long", 0) == (0 if listed else 1)


@pytest.mark.parametrize("extra, listed", [(0, True), (1, False)])
def test_a_risc_name_is_listed_up_to_the_bound_in_bytes(tmp_path, extra, listed):
    risc = _wide(tools.MAX_RISC_NAME_LENGTH + extra)

    result = _zone_timings(tmp_path, [("MATMUL", risc, 900)])

    assert ([zone["risc"] for zone in result["zones"]] == [risc]) is listed
    assert result.get("zones_unlisted_too_long", 0) == (0 if listed else 1)


@pytest.mark.parametrize("extra, listed", [(0, True), (1, False)])
def test_core_spread_lists_a_risc_up_to_the_bound_in_bytes(tmp_path, extra, listed):
    risc = _wide(tools.MAX_RISC_NAME_LENGTH + extra)

    op = _spread(
        tmp_path, _zone(0, 1, 1, risc, 0, 2000), [_op(cores="1")], perf_id="1"
    )["ops"][0]

    assert (list(op["by_risc"]) == [risc]) is listed
    assert op.get("by_risc_unlisted_too_long", 0) == (0 if listed else 1)


@pytest.mark.parametrize(
    "character, repeats, listed",
    [
        (WIDE, None, 100),
        ("😀", None, 100),
        ("\x01", None, 100),
        ("\x01", 253, 0),
    ],
    ids=["three-byte", "four-byte", "control", "control-past-the-bound"],
)
def test_a_hundred_names_keep_zone_timings_within_its_budget(
    tmp_path, character, repeats, listed
):
    """The issue's case: 100 distinct names of 256 three-byte characters answered
    87,401 B. A name that takes the bound in an answer is listed, a longer one not."""
    fill = repeats or (tools.MAX_ZONE_NAME_LENGTH - 3) // answer_size(character)
    names = [f"{index:03}" + character * fill for index in range(100)]

    result = _zone_timings(
        tmp_path, [(name, "BRISC", 900) for name in names], limit=100
    )

    assert result["returned"] == listed
    assert len(server._answer_text(result).encode()) < ANSWER_BUDGET_BYTES


@pytest.mark.parametrize(
    "zone",
    [_wide(tools.MAX_ZONE_NAME_LENGTH + 1), "\udc80" * 42 + "x" * 5],
    ids=["wide-characters", "lone-surrogates"],
)
def test_a_zone_argument_one_byte_past_the_bound_is_refused(tmp_path, zone):
    """A JSON argument can carry a lone surrogate, which the wire writes in six bytes."""
    with pytest.raises(ValueError, match="zone is 257 bytes as an answer writes it"):
        _intervals(tmp_path, _run(0, 1, 1, "BRISC", 0, [100]), zone=zone)


def _signposted(tmp_path, names):
    """A loaded report holding a signpost of each name, in order."""
    rows = smoke_rows()
    for position, name in enumerate(names, start=2):
        rows.insert(position, signpost(name, rows[position]))
    write_ops_perf(tmp_path, rows)
    registry = ReportRegistry()
    load_report(registry, performance_path=str(tmp_path))
    return registry


@pytest.mark.parametrize(
    "extra, refusal",
    [
        (0, "no signpost named"),
        (1, "start_signpost is 257 bytes as an answer writes it"),
    ],
)
def test_a_signpost_argument_is_taken_up_to_the_bound_in_bytes(
    tmp_path, extra, refusal
):
    """One at the bound is looked for, and missed; one byte past it is refused unread."""
    registry = _signposted(tmp_path, ["PERF_START"])

    with pytest.raises(ValueError, match=refusal):
        tools.top_ops(
            registry,
            "report-1",
            start_signpost=_wide(tools.MAX_SIGNPOST_NAME_LENGTH + extra),
        )


def test_a_signpost_argument_within_the_schema_is_refused_by_its_bytes(tmp_path):
    """100 characters pass the schema's maxLength; the tool refuses their 300 bytes."""
    registry = _signposted(tmp_path, ["PERF_START"])

    result, outcome = tool_call(
        registry, "top_ops", {"handle": "report-1", "start_signpost": WIDE * 100}
    )

    assert result["isError"] and outcome is McpToolOutcome.REFUSED
    assert "start_signpost is 300 bytes as an answer writes it" in (
        result["content"][0]["text"]
    )


@pytest.mark.parametrize("extra, kept", [(0, True), (1, False)])
def test_a_trace_label_is_kept_up_to_the_bound_in_bytes(extra, kept):
    label = _wide(noc_congestion.MAX_LABEL_LENGTH + extra)

    assert (noc_congestion._label(label) == label) is kept


def test_a_zone_argument_within_the_bound_answers(tmp_path):
    zone = _wide(tools.MAX_ZONE_NAME_LENGTH)
    rows = [
        modern_row(0, 1, 1, "BRISC", 0, "BRISC-KERNEL", "ZONE_START"),
        modern_row(0, 1, 1, "BRISC", 10, zone, "ZONE_START"),
        modern_row(0, 1, 1, "BRISC", 20, zone, "ZONE_END"),
        modern_row(0, 1, 1, "BRISC", 1010, zone, "ZONE_START"),
        modern_row(0, 1, 1, "BRISC", 1020, zone, "ZONE_END"),
    ]

    answer = _intervals(tmp_path, rows, zone=zone)

    assert answer["zone"] == zone


@pytest.mark.parametrize("extra, kept", [(0, True), (1, False)])
def test_a_trace_link_name_is_kept_up_to_the_bound_in_bytes(extra, kept):
    name = _wide(noc_congestion.MAX_LINK_NAME_LENGTH + extra)

    assert (noc_congestion._link(0, 1, 2, name) is not None) is kept


@pytest.mark.parametrize("extra, kept", [(0, True), (1, False)])
def test_a_trace_noc_name_is_kept_up_to_the_bound_in_bytes(extra, kept):
    name = _wide(noc_congestion.MAX_LINK_NAME_LENGTH + extra)

    run = noc_congestion._run({"noc": {name: {"avg_link_demand": 1.0}}})

    assert (list(run["by_noc"]) == [name]) is kept


@pytest.mark.parametrize("extra, listed", [(0, True), (1, False)])
def test_a_signpost_is_listed_up_to_the_bound_in_bytes(tmp_path, extra, listed):
    name = _wide(tools.MAX_SIGNPOST_NAME_LENGTH + extra)
    rows = smoke_rows()
    rows.insert(2, signpost(name, rows[2]))
    write_ops_perf(tmp_path, rows)
    registry = ReportRegistry()

    loaded = tools.with_signposts(
        registry, load_report(registry, performance_path=str(tmp_path))
    )

    assert ([entry["name"] for entry in loaded["signposts"]] == [name]) is listed
    assert loaded.get("signposts_unlisted_too_long", 0) == (0 if listed else 1)


def test_an_unknown_signpost_refusal_lists_only_names_a_range_can_take(tmp_path):
    """The names `load_report` lists: one past the bound would be refused if passed."""
    long_name = _wide(tools.MAX_SIGNPOST_NAME_LENGTH + 1)
    rows = smoke_rows()
    rows.insert(2, signpost("PERF_START", rows[2]))
    rows.insert(3, signpost(long_name, rows[3]))
    write_ops_perf(tmp_path, rows)
    registry = ReportRegistry()
    load_report(registry, performance_path=str(tmp_path))

    with pytest.raises(ValueError) as refused:
        tools.top_ops(registry, "report-1", start_signpost="TYPO")

    assert str(refused.value) == (
        "'report-1': no signpost named 'TYPO' in this report; it holds 'PERF_START'; "
        f"1 more have names past {tools.MAX_SIGNPOST_NAME_LENGTH} bytes, which are "
        "not listed"
    )


_TOO_LONG_NOTE = f"1 more have names past {tools.MAX_SIGNPOST_NAME_LENGTH} bytes, which are not listed"
_TWENTY_LISTED = ", ".join(repr(f"S{index:02}") for index in range(20))


@pytest.mark.parametrize(
    "short, long, tail",
    [
        (23, 0, f"it holds {_TWENTY_LISTED} and 3 more"),
        (
            0,
            1,
            f"none of its signpost names is short enough to list; {_TOO_LONG_NOTE}",
        ),
        (21, 1, f"it holds {_TWENTY_LISTED} and 1 more; {_TOO_LONG_NOTE}"),
    ],
    ids=["past-the-list", "only-too-long", "both"],
)
def test_an_unknown_signpost_refusal_counts_what_it_leaves_out(
    tmp_path, short, long, tail
):
    names = [f"S{index:02}" for index in range(short)]
    names += [_wide(tools.MAX_SIGNPOST_NAME_LENGTH + 1)] * long
    registry = _signposted(tmp_path, names)

    with pytest.raises(ValueError) as refused:
        tools.top_ops(registry, "report-1", start_signpost="TYPO")

    assert str(refused.value) == (
        f"'report-1': no signpost named 'TYPO' in this report; {tail}"
    )


@pytest.mark.parametrize("value", [123, True])
def test_a_signpost_argument_that_is_no_string_is_a_bad_argument(value):
    """A TypeError, which the server answers as bad arguments rather than a failure."""
    with pytest.raises(TypeError):
        tools.SignpostRange.of(value)
