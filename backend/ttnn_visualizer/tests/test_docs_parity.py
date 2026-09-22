# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""The shared duplicate guard, tested directly.

Every use of it is on a documentation page that has no duplicates, so the parity suites
pass whether the guard works or not — gutting it to ``return`` leaves the whole backend
suite green. That is the same shape as the hole it was written to close, one level up,
and the only way to close it is to exercise the guard rather than its callers. #2039
"""

import pytest
from ttnn_visualizer.tests.docs_parity import reject_duplicates


def test_it_accepts_a_page_that_lists_each_key_once():
    reject_duplicates(["alpha", "beta"], page="page.md", plural="tools")


def test_it_rejects_a_repeated_key_and_names_it():
    # Naming the key is the point: the hand-written checks this replaced said only that
    # a duplicate existed, which leaves the reader to find it.
    with pytest.raises(AssertionError) as failure:
        reject_duplicates(["alpha", "beta", "alpha"], page="page.md", plural="tools")

    assert "alpha" in str(failure.value)
    assert "beta" not in str(failure.value)
    assert "page.md" in str(failure.value)
    assert "tools" in str(failure.value)


def test_it_names_every_repeated_key_rather_than_the_first():
    with pytest.raises(AssertionError) as failure:
        reject_duplicates(
            ["alpha", "beta", "alpha", "beta"], page="page.md", plural="fields"
        )

    assert "'alpha', 'beta'" in str(failure.value)


def test_it_reads_a_one_pass_iterator():
    # Three call sites pass a generator expression. An implementation that walked the
    # input twice — a `count()` inside a comprehension, say — would see the second pass
    # as empty and never report anything.
    with pytest.raises(AssertionError):
        reject_duplicates(
            (key for key in ["alpha", "alpha"]), page="page.md", plural="tools"
        )
