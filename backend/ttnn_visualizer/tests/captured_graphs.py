# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Captured-graph nodes for the circular-buffer tests, built in one place. #2185

`test_agent_circular_buffers.py`, `test_agent_failure_parity.py` and
`test_agent_failures.py` all build these nodes; one builder keeps a node's shape from
drifting between them when the port starts reading another param. A module rather than
helpers in ``conftest.py``, for the reason ``event_log_readers.py`` gives.

Values are written as given. A capture writes strings, but the parity golden also feeds
numbers, to hold the app's `parseInt` reading of them.
"""

from typing import Dict, List, Optional

# Two by two cores, in the legacy corner syntax most local captures write.
CORE_RANGE_SET = "{[(x=0,y=0) - (x=1,y=1)]}"


def circular_buffer(
    address: object = "100",
    size: object = "4096",
    core_range_set: Optional[str] = CORE_RANGE_SET,
    device_id: object = None,
    globally_allocated: object = "0",
) -> Dict:
    """A `circular_buffer_allocate` node; a None range or device is left out."""
    params: Dict = {"address": address, "size": size}
    if core_range_set is not None:
        params["core_range_set"] = core_range_set
    params["globally_allocated"] = globally_allocated
    if device_id is not None:
        params["device_id"] = device_id
    return {"node_type": "circular_buffer_allocate", "params": params}


class CapturedGraph:
    """A graph whose nodes carry the ids the app keys snapshots by, in order.

    It opens with `capture_start`, which the app's walk skips.
    """

    def __init__(self) -> None:
        self.nodes: List[object] = [
            {"id": 0, "node_type": "capture_start", "params": {}}
        ]

    def add(self, node: object) -> "CapturedGraph":
        """Append `node`, numbered next unless it is not a dict or has an id."""
        if isinstance(node, dict) and "id" not in node:
            node = {"id": len(self.nodes), **node}
        self.nodes.append(node)
        return self

    def start(self, name: str) -> "CapturedGraph":
        return self.add({"node_type": "function_start", "params": {"name": name}})

    def end(self) -> "CapturedGraph":
        return self.add({"node_type": "function_end", "params": {}})

    def free_all(self) -> "CapturedGraph":
        return self.add({"node_type": "circular_buffer_deallocate_all", "params": {}})

    def cb(
        self,
        address: object = "100",
        size: object = "4096",
        core_range_set: Optional[str] = CORE_RANGE_SET,
        device_id: object = None,
        globally_allocated: object = "0",
    ) -> "CapturedGraph":
        return self.add(
            circular_buffer(
                address, size, core_range_set, device_id, globally_allocated
            )
        )

    def tensor(self) -> "CapturedGraph":
        # Read by the app's tensor arm of the same loop; the port passes it over.
        return self.add(
            {
                "node_type": "buffer_allocate",
                "params": {
                    "address": "900",
                    "type": "L1",
                    "size": "65536",
                    "num_cores": "64",
                },
            }
        )
