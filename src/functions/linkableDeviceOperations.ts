// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DeviceOperationParams, Node, NodeType } from '../model/APIData';
import { isDeviceOperation } from './filterOperations';

export type DeviceOperationNodeType = NodeType.function_start | NodeType.function_end;

// tt-metal writes this string, not a boolean: graph params are all strings and only
// `program_cache_hit` is converted when the graph is serialised. A boolean is accepted
// too, in case a later serialiser converts it. `linking.py` reads it the same way.
const ABORTED_PARAM_VALUE = 'true';

const getNodeName = (node: Node): string | undefined => (node.params as DeviceOperationParams | null)?.name;

const isAbortedEnd = (node: Node): boolean => {
    const aborted = (node.params as { aborted?: unknown } | null)?.aborted;

    return aborted === true || aborted === ABORTED_PARAM_VALUE;
};

/** Indices of the starts and ends of every scope that closed without aborting. */
const getCompletedScopeIndices = (nodes: Node[]) => {
    const openStarts: { name: string | undefined; index: number }[] = [];
    const starts = new Set<number>();
    const ends = new Set<number>();

    nodes.forEach((node, index) => {
        if (node.node_type === NodeType.function_start) {
            openStarts.push({ name: getNodeName(node), index });
            return;
        }

        if (node.node_type !== NodeType.function_end) {
            return;
        }

        const name = getNodeName(node);
        let openIndex = openStarts.length - 1;

        while (openIndex >= 0 && openStarts[openIndex].name !== name) {
            openIndex -= 1;
        }

        if (openIndex < 0) {
            return;
        }

        if (!isAbortedEnd(node)) {
            starts.add(openStarts[openIndex].index);
            ends.add(index);
        }

        openStarts.splice(openIndex, 1);
    });

    return { starts, ends };
};

const getDeviceOperationNames = (
    nodes: Node[],
    nodeType: DeviceOperationNodeType,
    include: (index: number) => boolean,
): string[] => {
    const names: string[] = [];

    nodes.forEach((node, index) => {
        const name = getNodeName(node);

        if (node.node_type === nodeType && name !== undefined && isDeviceOperation(name) && include(index)) {
            names.push(name);
        }
    });

    return names;
};

export interface LinkableDeviceOperations {
    starts: string[];
    ends: string[];
}

/**
 * The device operation names in one operation's captured graph that can have produced a
 * perf row, in each captured order.
 *
 * A device operation whose launch threw never reached the device, so it has no perf
 * row. Left in, it takes the next same-named row (typically the script's retry) and
 * shifts every later row onto the wrong operation. Two shapes of failure:
 * - Newer captures close the scope with a `function_end` marked `aborted`.
 * - Older captures leave the `function_start` with no `function_end` at all.
 *
 * A start counts only when a non-aborted end of the same name closes it. Each end
 * closes the latest open start of its name, which pairs nested and sequential scopes
 * alike and needs no node ids. Across the local report corpus (22,915 device
 * operation starts), the only starts this drops belong to operations with a recorded
 * error. A capture cut off mid-operation also leaves its last start unclosed; that
 * start is dropped too, so the capture's last perf row goes unclaimed.
 *
 * `deviceOperationNameList` keeps every device operation on purpose. The op list
 * filter and the graph panel are where a user goes looking for the failed one.
 *
 * Mirrored as `_device_operation_names` in `backend/ttnn_visualizer/agent/linking.py`.
 */
export const getLinkableDeviceOperations = (nodes: Node[] | null | undefined): LinkableDeviceOperations => {
    if (!Array.isArray(nodes)) {
        return { starts: [], ends: [] };
    }

    const completed = getCompletedScopeIndices(nodes);

    return {
        starts: getDeviceOperationNames(nodes, NodeType.function_start, (index) => completed.starts.has(index)),
        ends: getDeviceOperationNames(nodes, NodeType.function_end, (index) => completed.ends.has(index)),
    };
};

/** The device operations in one operation's captured graph whose launch did not complete. */
export const getFailedDeviceOperationNames = (nodes: Node[] | null | undefined): string[] => {
    if (!Array.isArray(nodes)) {
        return [];
    }

    const { starts } = getCompletedScopeIndices(nodes);

    return getDeviceOperationNames(nodes, NodeType.function_start, (index) => !starts.has(index));
};
