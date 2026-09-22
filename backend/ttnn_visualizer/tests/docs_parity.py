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
hand, and a page saying the same thing twice is a page nobody checked.

Shared rather than written per parser because two of the six had already grown their own
copy, spelled differently and reporting a failure that did not name the repeated key. #2039
"""

from collections import Counter
from typing import Iterable


def reject_duplicates(keys: Iterable[str], *, page: str, plural: str) -> None:
    """Fail when a documentation page lists the same key more than once."""
    repeated = sorted(key for key, count in Counter(keys).items() if count > 1)

    if repeated:
        raise AssertionError(
            f"{page} lists {plural} {repeated} more than once. This suite reduces "
            "every parsed row to a set or a dict before comparing, so a duplicate "
            "would survive all of it; it is rejected here instead."
        )
