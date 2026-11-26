# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Parity between the agent's source line groups and the performance view's. #2370

`source_lines.source_line_groups` restates `getSourceLineGroups` in
`src/functions/perfSourceLines.ts`. This test feeds the port curated and seeded report
rows, their links and each operation's stack trace text, and writes its groups to a
golden file; `tests/agentSourceLinesParity.spec.ts` asserts the app's function gives the
same groups from the same inputs. The traces are text, read by `failures._call_site` as
the tool reads them, so the golden holds frame 0's parse of the trace shapes
`TestFrameParity` (`test_agent_operations.py`) shows both sides read alike, as well as
the grouping. Rows span two devices, which the app merges and the port never keys by.

Only inputs where the two sides are meant to agree: devices merged, paths that first
differ letter against letter (code point and `localeCompare` order differ on case and
punctuation), and frames on a line in 1 to 2**31. `test_agent_source_lines.py` pins the
documented differences.

    pnpm run agent:parity-golden    <- regenerates tests/data/agentSourceLinesParity.json
"""

import random
from typing import Dict, List, Mapping, Optional, Sequence

from ttnn_visualizer.agent import failures, source_lines, tools
from ttnn_visualizer.agent.source_lines import SourceLineKind
from ttnn_visualizer.csv_queries import SIGNPOST_OP_TYPE
from ttnn_visualizer.tests.parity_golden import Golden

GOLDEN = Golden("agentSourceLinesParity")
_SEED = 2370

# Equal length and lowercase letters only, so any two paths first differ letter against
# letter, where code point and `localeCompare` order agree.
_DIRECTORIES = ("attn", "mlps", "norm")
_FILE_NAMES = ("bloc", "head", "core")
_PATHS = [
    f"/m/{directory}/{name}.py" for directory in _DIRECTORIES for name in _FILE_NAMES
]
_OP_CODES = ("A", "B", "C", "D", "E", "F")
_DEVICE_TIMES = ("", "0", "-1", "0.5", "1", "2.25", "10")
_DEVICES = ("0", "1")
# Device time cells `parseFloat` and Python's `float` read differently: `float` refuses
# `1abc` and `1e`, reads `1_0` as 10, and reads the full-width one as 1. #2428
_PARSE_FLOAT_ONLY_CELLS = ("1abc", "1_0", "1e", "\uff11")


# The cells either side reads to group a row; a report row has more, which neither reads.
_ROW_DEFAULTS: Dict[str, object] = {
    "op_code": "A",
    "raw_op_code": "A",
    "op_type": "tt_dnn_device",
    "device": "0",
    "device_time": "1",
}


def _trace(path: str, line: int, function: str = "forward") -> str:
    """A two-frame CPython trace whose frame 0 is `path`:`line`.

    Defined here rather than shared with `test_agent_source_lines.py`, so editing a
    trace for another test cannot change this golden's inputs.
    """
    return (
        f'  File "{path}", line {line}, in {function}\n'
        "    x = ttnn.op(x)\n"
        '  File "/harness/run.py", line 1, in <module>\n'
        "    main()\n"
    )


def _rows(*overrides: Mapping[str, object]) -> List[Dict[str, object]]:
    """Report rows as the generator writes them: cells are text, ids CSV positions."""
    return [
        {"id": str(index + 2), **_ROW_DEFAULTS, **fields}
        for index, fields in enumerate(overrides)
    ]


def _group(group: source_lines.SourceLineGroup, total: float) -> Dict[str, object]:
    site = group.call_site or {}
    entry: Dict[str, object] = {
        "kind": group.kind.value,
        "file": site.get("file"),
        "line": site.get("line"),
        "device_time": group.device_time,
        "row_count": group.row_count,
        "top_op_codes": [op_code for op_code, _ in group.top_op_codes()],
        "operation_ids": list(group.operation_ids),
    }
    # The app shows 0% where the tool answers null, so a share is held only where both
    # give one.
    if total > 0:
        entry["share_percent"] = tools.share_percent(group.device_time, total)
    return entry


def _case(
    rows: List[Dict[str, object]],
    operation_by_perf_id: Mapping[str, int],
    stack_traces: Mapping[int, Optional[str]],
) -> Dict:
    """One case: the inputs the app's function takes, and the port's groups.

    An operation absent from `stack_traces` is one missing from the app's operations
    list; one mapped to None recorded no trace.
    """
    call_sites = {
        operation_id: failures._call_site(stack_traces.get(operation_id))
        for operation_id in operation_by_perf_id.values()
    }
    groups = source_lines.source_line_groups(
        [row for row in rows if not tools.is_signpost_row(row)],
        operation_by_perf_id,
        call_sites,
        tools.countable_device_time,
        lambda row: "unlinked",
    )
    total = sum(group.device_time for group in groups)
    return {
        "rows": rows,
        "opIdsMap": [
            {"perfId": perf_id, "opId": operation_id}
            for perf_id, operation_id in operation_by_perf_id.items()
        ],
        "stackTraces": {
            str(operation_id): trace for operation_id, trace in stack_traces.items()
        },
        "groups": [_group(group, total) for group in groups],
    }


def _linked(rows: Sequence[Dict[str, object]], *operation_ids: Optional[int]) -> Dict:
    """Each row's perf id mapped to its operation, or left out where it is None."""
    return {
        str(row["id"]): operation_id
        for row, operation_id in zip(rows, operation_ids)
        if operation_id is not None
    }


def _curated_cases() -> List[Dict]:
    """Each rule once, since a random case rarely lands on a tie or an edge."""
    cases = []

    # Two operations sharing frame 0 merge; an operation with two rows is listed once,
    # in the order the rows first name them, which is not numeric order: [8, 7].
    rows = _rows(
        {"device_time": "2"},
        {"device_time": "3", "raw_op_code": "B"},
        {"device_time": "4"},
    )
    cases.append(
        _case(
            rows,
            _linked(rows, 8, 7, 8),
            {7: _trace("/m/attn/bloc.py", 12), 8: _trace("/m/attn/bloc.py", 12)},
        )
    )

    # The key is the full path and line: a shared basename and a shared file split.
    rows = _rows({"device_time": "1"}, {"device_time": "2"}, {"device_time": "3"})
    cases.append(
        _case(
            rows,
            _linked(rows, 1, 2, 3),
            {
                1: _trace("/m/attn/bloc.py", 5),
                2: _trace("/m/mlps/bloc.py", 5),
                3: _trace("/m/attn/bloc.py", 6),
            },
        )
    )

    # Unlinked rows, and each way a linked row reads no trace: a null trace, an
    # operation missing from the list, and a trace that names no Python frame.
    rows = _rows(
        {"device_time": "1"},
        {"device_time": "2"},
        {"device_time": "3"},
        {"device_time": "4"},
        {"device_time": "5"},
        {"device_time": "6"},
    )
    cases.append(
        _case(
            rows,
            _linked(rows, None, None, 1, 2, 3, 4),
            {
                1: None,
                3: "RuntimeError: no frame here",
                4: _trace("/m/norm/head.py", 9),
            },
        )
    )

    # Signposts are left out of every group.
    rows = _rows(
        {"op_code": "start", "op_type": SIGNPOST_OP_TYPE, "device_time": "5"},
        {"device_time": "1"},
        {"op_code": "end", "op_type": SIGNPOST_OP_TYPE, "device_time": ""},
    )
    cases.append(
        _case(
            rows,
            _linked(rows, None, 1, None),
            {1: _trace("/m/attn/core.py", 3)},
        )
    )

    # A row without countable device time counts as a row and adds no time or op code.
    rows = _rows(
        {"device_time": "2", "raw_op_code": "A"},
        {"device_time": "", "raw_op_code": "B"},
        {"device_time": "0", "raw_op_code": "C"},
        {"device_time": "-1", "raw_op_code": "D"},
    )
    cases.append(
        _case(rows, _linked(rows, 1, 1, 1, 1), {1: _trace("/m/attn/core.py", 3)})
    )

    # Top op codes by device time, ties by name, capped; a timed row without an op code
    # is filed under an empty one.
    rows = _rows(
        {"device_time": "1", "raw_op_code": "D"},
        {"device_time": "5", "raw_op_code": "C"},
        {"device_time": "3", "raw_op_code": "B"},
        {"device_time": "3", "raw_op_code": "A"},
        {"device_time": "7", "raw_op_code": ""},
    )
    cases.append(
        _case(rows, _linked(rows, 1, 1, 1, 1, 1), {1: _trace("/m/attn/bloc.py", 1)})
    )

    # Ties on device time break by kind, then path, then line as text: "10" before "9".
    rows = _rows(*[{"device_time": "1"} for _ in range(6)])
    cases.append(
        _case(
            rows,
            _linked(rows, 1, 2, 3, 4, None, 6),
            {
                1: _trace("/m/norm/bloc.py", 2),
                2: _trace("/m/attn/bloc.py", 9),
                3: _trace("/m/attn/bloc.py", 10),
                4: _trace("/m/attn/head.py", 1),
                6: None,
            },
        )
    )

    # Rows of one line on two devices are one group: the app merges devices, and the
    # port has no device key.
    rows = _rows(
        {"device": "0", "device_time": "2"},
        {"device": "1", "device_time": "3", "raw_op_code": "B"},
        {"device": "1", "device_time": "4"},
    )
    cases.append(
        _case(
            rows,
            _linked(rows, 1, 2, 3),
            {
                1: _trace("/m/attn/bloc.py", 7),
                2: _trace("/m/attn/bloc.py", 7),
                3: _trace("/m/norm/core.py", 2),
            },
        )
    )

    # Frame 0 in the trace shapes `TestFrameParity` shows both sides read alike: a
    # header line, CRLF, blank lines, a partial frame line skipped, whitespace after the
    # function, a path with a space, and a quote in the path, which is no frame at all.
    rows = _rows(*[{"device_time": str(index + 1)} for index in range(7)])
    cases.append(
        _case(
            rows,
            _linked(rows, 1, 2, 3, 4, 5, 6, 7),
            {
                1: "Traceback (most recent call last):\n"
                + _trace("/m/attn/head.py", 3),
                2: '  File "/m/mlps/head.py", line 4, in f\r\n    x()\r\n',
                3: '  File "/m/norm/head.py", line 5, in f\n    x = (\n\n  y()\n',
                4: '  File "/m/partial.py"\n  File "/m/attn/core.py", line 6, in f\n',
                5: '  File "/m/mlps/core.py", line 7, in forward  \t\n    x()\n',
                6: _trace("/m/my dir/bloc.py", 8),
                7: '  File "/m/we"ird.py", line 9, in f\n    x()\n',
            },
        )
    )

    # The cells `parseFloat` and `float` read differently, then a plain one: read either
    # way, the two lines' sums and their order differ.
    rows = _rows(
        *[
            {"device_time": cell, "raw_op_code": op_code}
            for cell, op_code in zip(_PARSE_FLOAT_ONLY_CELLS, "ABAA")
        ],
        {"device_time": "2"},
    )
    cases.append(
        _case(
            rows,
            _linked(rows, 1, 1, 2, 2, 2),
            {1: _trace("/m/attn/bloc.py", 4), 2: _trace("/m/mlps/head.py", 9)},
        )
    )

    # No countable device time at all: no shares, every group still listed.
    rows = _rows({"device_time": ""}, {"device_time": "0"})
    cases.append(_case(rows, _linked(rows, 1, None), {1: _trace("/m/attn/bloc.py", 4)}))
    return cases


def _random_case(rng: random.Random) -> Dict:
    operation_count = rng.randint(1, 8)
    stack_traces: Dict[int, Optional[str]] = {}
    for operation_id in range(1, operation_count + 1):
        draw = rng.random()
        if draw < 0.1:
            stack_traces[operation_id] = None
        elif draw < 0.15:
            continue  # Missing from the operations list.
        else:
            stack_traces[operation_id] = _trace(
                rng.choice(_PATHS), rng.randint(1, 200), rng.choice(("f", "forward"))
            )
    rows = _rows(
        *[
            {
                "raw_op_code": rng.choice(_OP_CODES),
                "device_time": rng.choice(_DEVICE_TIMES),
                "device": rng.choice(_DEVICES),
            }
            for _ in range(rng.randint(5, 40))
        ]
    )
    operation_ids = [
        None if rng.random() < 0.1 else rng.randint(1, operation_count) for _ in rows
    ]
    return _case(rows, _linked(rows, *operation_ids), stack_traces)


def _generate_golden() -> Dict:
    rng = random.Random(_SEED)
    return {
        "_comment": (
            "Generated by backend/ttnn_visualizer/tests/test_agent_source_lines_parity.py "
            "from the agent's port. Do not edit by hand; run pnpm run agent:parity-golden."
        ),
        "cases": _curated_cases() + [_random_case(rng) for _ in range(20)],
    }


def test_the_golden_matches_the_port():
    GOLDEN.check(_generate_golden())


def test_the_golden_covers_every_kind_and_both_share_states():
    groups = [group for case in _generate_golden()["cases"] for group in case["groups"]]

    assert {group["kind"] for group in groups} == {
        kind.value for kind in SourceLineKind
    }
    assert any("share_percent" in group for group in groups)
    assert any("share_percent" not in group for group in groups)


def test_the_golden_covers_two_devices_and_signposts():
    """Each is a rule a single-device, signpost-free golden would leave unheld."""
    rows = [row for case in _generate_golden()["cases"] for row in case["rows"]]

    assert {row["device"] for row in rows} == set(_DEVICES)
    assert any(tools.is_signpost_row(row) for row in rows)


def test_the_golden_covers_cells_parse_float_reads_differently():
    """`countable_device_time` reads a cell as the app's `parseFloat` does, which these
    hold; a golden of plain decimals would pass with Python's `float`. #2428"""
    rows = [row for case in _generate_golden()["cases"] for row in case["rows"]]

    assert set(_PARSE_FLOAT_ONLY_CELLS) <= {row["device_time"] for row in rows}


def test_the_ts_spec_reads_this_golden():
    GOLDEN.check_spec_reads_it()
