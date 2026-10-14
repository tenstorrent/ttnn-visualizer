// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DeviceOperationNode, DeviceOperationNodeEnd, DeviceOperationNodeType, Node, NodeType } from '../model/APIData';
import { isDeviceOperation } from './filterOperations';

/**
 * Whether the active memory report is linked to the performance report, so its per-operation
 * findings may be shown against perf rows. Anything that could blame one run's operations on
 * another's rows gates on this, so "linked" means the same thing everywhere.
 */
export const isMemoryReportLinked = <T>(
    operations: T[] | null | undefined,
    opIdsMap: readonly unknown[],
): operations is T[] => !!operations?.length && opIdsMap.length > 0;

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
}

/**
 * Pairs each end with the latest open start of its name, which pairs nested and
 * sequential scopes alike and needs no node ids. The perf linking and
 * `getScopeOutcomes` both pair ends to starts this way; only the latter decides what
 * happens to the scopes no end closes.
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

    return { startIndexByEndIndex, abortedEndIndices };
};

/** The starts and ends of every scope that closed without aborting, each end with its start. */
const getCompletedScopeIndices = (nodes: Node[]) => {
    const { startIndexByEndIndex, abortedEndIndices } = getScopePairing(nodes);
    const starts = new Set<number>();
    const startIndexByEnd = new Map<number, number>();

    startIndexByEndIndex.forEach((startIndex, endIndex) => {
        if (!abortedEndIndices.has(endIndex)) {
            starts.add(startIndex);
            startIndexByEnd.set(endIndex, startIndex);
        }
    });

    return { starts, startIndexByEnd };
};

/** The reason tt-metal gave for aborting a scope; `null` when it gave none. */
export const getAbortReason = (node: DeviceOperationNodeEnd): string | null => {
    const reason = node.params?.abort_reason;

    return typeof reason === 'string' && reason.trim() !== '' ? reason : null;
};

/** A device operation that can have produced a perf row, and the scope it ran in. */
export interface LinkableDeviceOperation {
    name: string;
    /** The `function_start` node that opens its scope, whichever order lists it. */
    startNodeId: number;
}

const getLinkableScopes = (
    nodes: Node[],
    nodeType: DeviceOperationNodeType,
    getStartIndex: (index: number) => number | undefined,
): LinkableDeviceOperation[] => {
    const scopes: LinkableDeviceOperation[] = [];

    nodes.forEach((node, index) => {
        if (node.node_type !== nodeType) {
            return;
        }

        const name = getNodeName(node);
        const startIndex = getStartIndex(index);

        if (name !== undefined && isDeviceOperation(name) && startIndex !== undefined) {
            scopes.push({ name, startNodeId: nodes[startIndex].id });
        }
    });

    return scopes;
};

export interface LinkableDeviceOperations {
    starts: LinkableDeviceOperation[];
    ends: LinkableDeviceOperation[];
}

/**
 * The device operations in one operation's captured graph that can have produced a
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
        starts: getLinkableScopes(nodes, NodeType.function_start, (index) =>
            completed.starts.has(index) ? index : undefined,
        ),
        ends: getLinkableScopes(nodes, NodeType.function_end, (index) => completed.startIndexByEnd.get(index)),
    };
};
