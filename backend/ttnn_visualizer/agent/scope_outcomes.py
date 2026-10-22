# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Which device operations in a captured graph failed to launch. #2154

A port of `getScopePairing` (`src/functions/linkableDeviceOperations.ts`) and of
`getScopeOutcomes` and `getFailedDeviceOperationNames` (`src/functions/scopeOutcomes.ts`);
mirror a change there.
"""

from typing import Dict, List, Optional, Set, Tuple

_FUNCTION_START = "function_start"
_FUNCTION_END = "function_end"
# See `isAbortedEnd`: graph params are strings, but a boolean is read the same.
_ABORTED_PARAM_VALUE = "true"


def is_device_operation(name: str) -> bool:
    """`isDeviceOperation` in `src/functions/filterOperations.ts`, kept identical."""
    return (
        name != ""
        and "(torch)" not in name
        and "::" not in name
        and "ttnn." not in name
    )


def _name(node: Dict) -> Optional[str]:
    params = node.get("params")
    name = params.get("name") if isinstance(params, dict) else None
    return name if isinstance(name, str) else None


def _is_aborted_end(node: Dict) -> bool:
    params = node.get("params")
    aborted = params.get("aborted") if isinstance(params, dict) else None
    return aborted is True or aborted == _ABORTED_PARAM_VALUE


def scope_pairing(nodes: List[Dict]) -> Tuple[Dict[int, int], Set[int]]:
    """Each end's start, pairing an end with the latest open start of its name."""
    open_starts: List[Tuple[Optional[str], int]] = []
    start_by_end: Dict[int, int] = {}
    aborted_ends: Set[int] = set()
    for index, node in enumerate(nodes):
        node_type = node.get("node_type")
        if node_type == _FUNCTION_START:
            open_starts.append((_name(node), index))
            continue
        if node_type != _FUNCTION_END:
            continue
        name = _name(node)
        position = len(open_starts) - 1
        while position >= 0 and open_starts[position][0] != name:
            position -= 1
        if position < 0:
            continue
        start_by_end[index] = open_starts[position][1]
        if _is_aborted_end(node):
            aborted_ends.add(index)
        del open_starts[position]
    return start_by_end, aborted_ends


def _failed_starts(nodes: List[Dict]) -> Set[int]:
    """The start index of every scope that failed, reading a scope left open as failed.

    Called only for an operation with a recorded error, which is what makes an open
    scope a failure rather than a capture cut short.
    """
    start_by_end, aborted_ends = scope_pairing(nodes)
    open_scopes: List[Tuple[int, Optional[int]]] = []
    failed: Set[int] = set()

    for index, node in enumerate(nodes):
        node_type = node.get("node_type")
        if node_type == _FUNCTION_START:
            level = node.get("stacking_level")
            level = (
                level
                if isinstance(level, int) and not isinstance(level, bool)
                else None
            )
            # A sibling no deeper than the innermost open scope closes it: older
            # tt-metal left it open when it failed.
            while (
                level is not None
                and open_scopes
                and open_scopes[-1][1] is not None
                and open_scopes[-1][1] >= level
            ):
                failed.add(open_scopes.pop()[0])
            open_scopes.append((index, level))
        elif node_type == _FUNCTION_END:
            start = start_by_end.get(index)
            if start is None or all(scope[0] != start for scope in open_scopes):
                continue
            while open_scopes[-1][0] != start:
                failed.add(open_scopes.pop()[0])
            open_scopes.pop()
            if index in aborted_ends:
                failed.add(start)

    failed.update(scope[0] for scope in open_scopes)
    return failed


def failed_device_operation_names(nodes: object) -> List[str]:
    """The device operations whose launch did not complete, in captured order."""
    if not isinstance(nodes, list):
        return []
    graph = [node if isinstance(node, dict) else {} for node in nodes]
    failed = _failed_starts(graph)
    names: List[str] = []
    for index, node in enumerate(graph):
        if node.get("node_type") != _FUNCTION_START:
            continue
        name = _name(node)
        if name is not None and is_device_operation(name) and index in failed:
            names.append(name)
    return names


__all__ = ["failed_device_operation_names", "is_device_operation", "scope_pairing"]
