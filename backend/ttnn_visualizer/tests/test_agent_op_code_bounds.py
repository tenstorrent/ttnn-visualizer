# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Op codes are the capture's text, so every tool that shows one cuts it at
`MAX_OP_CODE_CHARS`, and a digest tells apart two codes cut alike. #2208
"""

from unittest.mock import patch

import pytest
from ttnn_visualizer.agent import tools
from ttnn_visualizer.agent.bounds import (
    CUT_DIGEST_CHARS,
    MAX_OP_CODE_CHARS,
    cut_text,
    shown_in_text,
)
from ttnn_visualizer.agent.handles import ReportRegistry, load_report
from ttnn_visualizer.tests.test_agent_tools import _perf_report, _row, _signposts_in
from ttnn_visualizer.tests.test_device_log_columns import (
    MODERN_HEADER,
    write_device_log,
)

LONG = "Matmul" + "x" * MAX_OP_CODE_CHARS
# Cut alike and as long as LONG, so only the digest tells them apart.
TWIN = LONG[:-1] + "y"


class TestCutText:
    def test_a_text_within_the_limit_is_shown_whole(self):
        assert cut_text("field", "abc", 3, digest=True) == {"field": "abc"}

    def test_a_text_past_the_limit_is_cut_with_its_length(self):
        assert cut_text("field", "abcd", 3) == {
            "field": "abc",
            "field_full_length": 4,
        }

    def test_a_digest_tells_two_texts_cut_alike_apart(self):
        first = cut_text("field", "abcX", 3, digest=True)
        second = cut_text("field", "abcY", 3, digest=True)

        assert first["field"] == second["field"]
        assert first["field_digest"] != second["field_digest"]
        assert len(first["field_digest"]) == CUT_DIGEST_CHARS

    @pytest.mark.parametrize("value", [None, "", 42])
    def test_a_value_that_is_no_text_is_shown_as_it_is(self, value):
        assert cut_text("field", value, 0, digest=True) == {"field": value}

    def test_a_text_for_a_sentence_says_it_was_cut(self):
        assert shown_in_text("abc", 3) == "abc"
        assert shown_in_text("abcdefg", 3) == "abc... (7 characters)"


@pytest.fixture
def report(tmp_path):
    """A loaded handle whose generated report holds the given rows."""
    patches = []

    def _report(rows):
        registry = ReportRegistry()
        write_device_log(tmp_path, MODERN_HEADER, [])
        load_report(registry, performance_path=str(tmp_path))
        generate = patch.object(
            tools, "_generate_canonical_report", return_value=_perf_report(rows)
        )
        generate.start()
        patches.append(generate)
        return registry

    with _signposts_in("report-1"):
        yield _report
    for started in patches:
        started.stop()


def _assert_cut(entry, field, whole):
    assert entry[field] == whole[:MAX_OP_CODE_CHARS]
    assert entry[f"{field}_full_length"] == len(whole)
    assert len(entry[f"{field}_digest"]) == CUT_DIGEST_CHARS


class TestOpCodes:
    def test_a_row_shows_its_op_code_cut(self, report):
        registry = report([_row(op_code=LONG), _row(id="2", op_code="Matmul")])

        ops = tools.top_ops(registry, "report-1")["ops"]

        _assert_cut(ops[0], "op_code", LONG)
        assert ops[1]["op_code"] == "Matmul"
        assert "op_code_full_length" not in ops[1]

    def test_program_cache_keeps_codes_cut_alike_apart(self, report):
        registry = report(
            [
                _row(id="1", op_code=LONG, hash="a", cache_hit="False"),
                _row(id="2", op_code=TWIN, hash="b", cache_hit="False"),
            ]
        )

        entries = tools.program_cache(registry, "report-1")["op_codes"]

        assert len(entries) == 2
        for entry in entries:
            _assert_cut(entry, "op_code", LONG)
        assert entries[0]["op_code_digest"] != entries[1]["op_code_digest"]
        assert list(entries[0])[:3] == [
            "op_code",
            "op_code_full_length",
            "op_code_digest",
        ]

    def test_op_breakdown_cuts_its_group_key_and_keeps_groups_apart(self, report):
        registry = report([_row(id="1", op_code=LONG), _row(id="2", op_code=TWIN)])

        groups = tools.op_breakdown(registry, "report-1")["groups"]

        assert len(groups) == 2
        assert {group["op_full_length"] for group in groups} == {len(LONG)}
        assert len({group["op_digest"] for group in groups}) == 2
        assert {group["op"] for group in groups} == {LONG[:MAX_OP_CODE_CHARS]}

    def test_a_refusal_that_names_an_op_code_cuts_it(self, report):
        registry = report(
            [_row(op_code=f"{LONG} (signpost)", op_type="signpost", device_time="")]
        )

        with pytest.raises(ValueError) as refusal:
            tools.core_spread(registry, "report-1", perf_id="1")

        quoted = repr(f"{LONG} (signpost)")
        assert f"is the signpost {quoted[:MAX_OP_CODE_CHARS]}... (" in str(
            refusal.value
        )
        assert len(str(refusal.value)) < MAX_OP_CODE_CHARS + 100

    def test_a_host_op_refusal_cuts_its_op_code(self, report):
        registry = report([_row(op_code=LONG, global_call_count="", device="")])

        with pytest.raises(ValueError) as refusal:
            tools.core_spread(registry, "report-1", perf_id="1")

        assert f"row 1 ({LONG[:MAX_OP_CODE_CHARS]}... (" in str(refusal.value)
