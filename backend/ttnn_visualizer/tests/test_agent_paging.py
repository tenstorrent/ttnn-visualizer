# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The `offset` a paged tool takes and the page it cuts, shared by `op_configurations`
and `source_lines`. #2369"""

import pytest
from ttnn_visualizer.agent.bounds import page_of, parsed_offset


@pytest.mark.parametrize(
    "offset, start", [(None, 0), (0, 0), (3, 3), ("3", 3), (2.0, 2)]
)
def test_an_offset_is_read_as_a_whole_number(offset, start):
    assert parsed_offset(offset) == start


@pytest.mark.parametrize(
    "offset, message",
    [
        (-1, "offset must be 0 or more"),
        ("two", "offset must be a whole number"),
        (1.5, "offset must be a whole number"),
        (True, "offset must be a whole number"),
        (False, "offset must be a whole number"),
        (float("inf"), "offset must be a whole number"),
        (float("nan"), "offset must be a whole number"),
        ([1], "offset must be a whole number"),
    ],
)
def test_an_offset_that_is_not_a_whole_number_of_0_or_more_is_refused(offset, message):
    with pytest.raises(ValueError, match=message):
        parsed_offset(offset)


@pytest.mark.parametrize(
    "start, count, page",
    [
        (0, 2, (0, ["a", "b"], 2)),
        (2, 2, (2, ["c", "d"], 4)),
        # Cut short by the end, so the last page.
        (3, 2, (3, ["d", "e"], None)),
        (4, 2, (4, ["e"], None)),
        # At or past the end: empty, and it says where the ranking ends.
        (5, 2, (5, [], None)),
        (50, 2, (5, [], None)),
    ],
)
def test_a_page_says_where_it_starts_and_where_the_next_does(start, count, page):
    assert page_of(["a", "b", "c", "d", "e"], start, count) == page


def test_a_page_of_nothing_is_empty_and_last():
    assert page_of([], 0, 10) == (0, [], None)
