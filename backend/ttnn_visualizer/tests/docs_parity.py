# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Shared guard for the documentation-parity suites.

Every one of these suites parses a page into rows and then reduces them — to a set of
ids, a dict keyed by name, a set of enum values — before comparing against the registry
they pin. A key listed twice collapses in that reduction, so the comparison sees a page
that matches and the duplicate survives every assertion in the file.

That makes the parse the only place it can be caught, and it has to be caught somewhere:
the whole point of these suites is that nobody has to read the page against the code by
hand, and a page saying the same thing twice is a page nobody checked. #2039
"""

from collections import Counter
from typing import Iterable


def reject_duplicates(keys: Iterable[str], *, page: str, noun: str) -> None:
    """Fail when a documentation page lists the same key more than once."""
    repeated = sorted(key for key, count in Counter(keys).items() if count > 1)

    if repeated:
        raise AssertionError(
            f"{page} lists {noun} {repeated} more than once. The comparisons in this "
            "suite are against sets, so a duplicate would survive all of them; it is "
            "rejected here instead."
        )
