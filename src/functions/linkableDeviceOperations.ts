// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DeviceOperationNode, DeviceOperationNodeEnd, DeviceOperationNodeType, Node, NodeType } from '../model/APIData';
import { isDeviceOperation } from './filterOperations';

// See `DeviceOperationEndParams.aborted`. `linking.py` reads it the same way.
const ABORTED_PARAM_VALUE = 'true';

// Graph params come straight from the capture, so `params` is guarded despite its type.
const getNodeName = (node: DeviceOperationNode | DeviceOperationNodeEnd): string | undefined => node.params?.name;

const isAbortedEnd = (node: DeviceOperationNodeEnd): boolean => {
    const aborted = node.params?.aborted;

    return aborted === true || aborted === ABORTED_PARAM_VALUE;
};

/** How the function scopes in one captured graph open and close, by node index. */
export interface ScopePairing {
    /** The start each end closes. An end with no open start of its name is left out. */
    startIndexByEndIndex: Map<number, number>;
    /** Ends that closed their scope because it threw. */
    abortedEndIndices: Set<number>;
    /** Starts that no end closed: a failure in older captures, or a capture cut off. */
    unclosedStartIndices: Set<number>;
}

/**
 * Pairs each end with the latest open start of its name, which pairs nested and
 * sequential scopes alike and needs no node ids. The device-operations tree and the
 * perf linking both read this, so they cannot disagree about which scope failed.
 */
export const getScopePairing = (nodes: Node[]): ScopePairing => {
    const openStarts: { name: string | undefined; index: number }[] = [];
    const startIndexByEndIndex = new Map<number, number>();
    const abortedEndIndices = new Set<number>();

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

        startIndexByEndIndex.set(index, openStarts[openIndex].index);

        if (isAbortedEnd(node)) {
            abortedEndIndices.add(index);
        }

        openStarts.splice(openIndex, 1);
    });

    return {
        startIndexByEndIndex,
        abortedEndIndices,
        unclosedStartIndices: new Set(openStarts.map(({ index }) => index)),
    };
};

/** Indices of the starts and ends of every scope that closed without aborting. */
const getCompletedScopeIndices = (nodes: Node[]) => {
    const { startIndexByEndIndex, abortedEndIndices } = getScopePairing(nodes);
    const starts = new Set<number>();
    const ends = new Set<number>();

    startIndexByEndIndex.forEach((startIndex, endIndex) => {
        if (!abortedEndIndices.has(endIndex)) {
            starts.add(startIndex);
            ends.add(endIndex);
        }
    });

    return { starts, ends };
};

/** The reason tt-metal gave for aborting a scope; `null` when it gave none. */
export const getAbortReason = (node: DeviceOperationNodeEnd): string | null => {
    const reason = node.params?.abort_reason;

    return typeof reason === 'string' && reason.trim() !== '' ? reason : null;
};

const getDeviceOperationNames = (
    nodes: Node[],
    nodeType: DeviceOperationNodeType,
    include: (index: number) => boolean,
): string[] => {
    const names: string[] = [];

    nodes.forEach((node, index) => {
        if (node.node_type !== nodeType) {
            return;
        }

        const name = getNodeName(node);

        if (name !== undefined && isDeviceOperation(name) && include(index)) {
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
 * row. Left in, it puts a name in the order that no row answers, and the alignment
 * (all or nothing) usually fails: a report with a failure would not link at all. Two
 * shapes of failure:
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
