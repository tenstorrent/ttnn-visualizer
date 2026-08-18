# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Append usage events from a fresh interpreter, for the concurrency test.

``_append_line``'s ``O_APPEND`` claim is about separate processes sharing one log, so
the only way to exercise it is from outside the test process. This is a real module
rather than a ``python -c`` payload so ``black``, ``isort`` and ``mypy`` inspect it
like the rest of the package; the missing ``test_`` prefix keeps pytest from
collecting it.

Failures here have to be loud. ``record_event`` swallows every exception by design,
so a child that cannot write a single line still exits 0 and the caller sees only a
count that does not add up. Check the preconditions here and exit non-zero instead.
"""

import sys
from pathlib import Path

from ttnn_visualizer import usage
from ttnn_visualizer.usage import (
    UsageEvent,
    UsageView,
    is_recording_enabled,
    record_event,
    record_events,
)


def main(argv: list[str]) -> int:
    """Write ``argv[2]`` events into the directory named by ``argv[1]``.

    An optional ``argv[3]`` batch size sends them through ``record_events`` in groups of
    that many. Batches are the case worth exercising separately: a batch is one
    multi-line ``os.write``, so it is where ``O_APPEND``'s guarantee has the most to do.
    """
    directory, count = Path(argv[1]), int(argv[2])
    batch_size = int(argv[3]) if len(argv) > 3 else 1

    # ``monkeypatch`` does not cross process boundaries, so apply the same override
    # the ``usage_directory`` fixture applies in-process.
    usage.USAGE_DIRECTORY = directory

    if not is_recording_enabled():
        print("recording is disabled; refusing to write", file=sys.stderr)
        return 1

    if batch_size > 1:
        event = (UsageEvent.VIEW_OPENED, {"view": UsageView.OPERATIONS})
        # A final short batch rather than `count // batch_size` whole ones, which would
        # drop the remainder — and write nothing at all when the batch is bigger than the
        # count. The lower-bound check below would catch it, but as a confusing failure
        # about interleaving rather than about arithmetic here.
        remaining = count
        while remaining:
            record_events([event] * min(batch_size, remaining))
            remaining -= min(batch_size, remaining)
    else:
        for _ in range(count):
            record_event(UsageEvent.APP_START)

    try:
        written = usage.get_usage_log_path().read_text(encoding="utf-8")
    except OSError as error:
        print(f"could not read back the log: {error}", file=sys.stderr)
        return 1

    # Only a lower bound: the other writers are appending to the same file.
    if len(written.splitlines()) < count:
        print(f"wrote fewer than {count} lines", file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
