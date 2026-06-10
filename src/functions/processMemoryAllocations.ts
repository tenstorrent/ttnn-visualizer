// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceOperationNode, Node, NodeType } from '../model/APIData';
import { L1_NUM_CORES } from '../definitions/L1MemorySize';
import { StringBufferType } from '../model/BufferType';
import { getCoresInRangeList } from './math';

export type AllocationDetails = {
    id: number;
    name: string | null;
    type: NodeType;
    total_cb: number;
    total_buffer: number;
    total_memory: number;
    deviceId: number;
};

export function processMemoryAllocations(
    graph: Node[],
    // _inputs: { id: number; size: number | null }[],
): {
    peakMemoryLoad: number;
    memoryAllocationList: AllocationDetails[];
} {
    let peakMemoryLoad = 0;
    const memoryAllocationList: AllocationDetails[] = [];
    const curOpList: { name: string; id: number; deviceId?: string | number }[] = [];
    const cbBytesByCore = new Map<string, number>();
    let totalBuffer = 0;

    const maxCbPerCore = (): number => {
        let m = 0;
        for (const v of cbBytesByCore.values()) {
            if (v > m) {
                m = v;
            }
        }
        return m;
    };

    let i = 1;
    while (i < graph.length) {
        const node = graph[i];
        i += 1;
        if (node.node_type === NodeType.function_start) {
            const { name } = node.params;
            curOpList.push({ name, id: node.id, deviceId: node.params.device_id });
        }
        const currentOp = curOpList[curOpList.length - 1];

        if (node.params?.device_id !== undefined && curOpList.length > 1) {
            curOpList[curOpList.length - 1].deviceId = node.params.device_id;
        }

        if (node.node_type === NodeType.circular_buffer_allocate) {
            // tracks allocation op for color variance downstream
            if (currentOp) {
                node.params.allocateOperationId = currentOp.id;
                node.params.allocateOperationName = currentOp.name;
            }
            const size = parseInt(node.params.size, 10);
            const cores = getCoresInRangeList(node.params.core_range_set);
            if (cores.length === 0) {
                cbBytesByCore.set('?', (cbBytesByCore.get('?') ?? 0) + size);
            } else {
                for (const { x, y } of cores) {
                    const k = `${x},${y}`;
                    cbBytesByCore.set(k, (cbBytesByCore.get(k) ?? 0) + size);
                }
            }
        }

        if (node.node_type === NodeType.circular_buffer_deallocate_all) {
            cbBytesByCore.clear();
        }

        if (node.node_type === NodeType.buffer_allocate && node.params.type === StringBufferType.L1) {
            const numCores = parseInt(node.params.num_cores, 10) || L1_NUM_CORES;
            const totalSize = parseInt(node.params.size, 10);
            totalBuffer += totalSize / numCores;
        }

        if (node.node_type === NodeType.function_end) {
            curOpList.pop();
        }

        if (node.node_type === NodeType.buffer_deallocate) {
            if (node.params.type === 'L1') {
                const cores = parseInt(node.params.num_cores, 10) || L1_NUM_CORES;
                const size = parseInt(node.params.size, 10) / cores;
                totalBuffer -= size;
            }
        }

        const cbPeak = maxCbPerCore();

        if (curOpList.length > 0) {
            const obj: AllocationDetails = {
                name: curOpList[curOpList.length - 1].name,
                deviceId: curOpList[curOpList.length - 1].deviceId as number,
                id: node.id,
                type: node.node_type,
                total_cb: cbPeak,
                total_buffer: totalBuffer,
                total_memory: cbPeak + totalBuffer,
            };
            memoryAllocationList.push(obj);
        }

        peakMemoryLoad = Math.max(peakMemoryLoad, cbPeak + totalBuffer);
    }

    return { peakMemoryLoad, memoryAllocationList };
}

export const processInputsOutputs = (graph: Node[]): DeviceOperationNode[] => {
    if (!Array.isArray(graph)) {
        return [];
    }
    const operations: DeviceOperationNode[] = [];
    const nodeByNodeId = new Map<number, Node>(graph.map((op) => [op.id, { ...op }]));

    const connected = (node: Node): Node[] =>
        (node.connections ?? []).map((id) => nodeByNodeId.get(id)).filter((n): n is Node => Boolean(n));

    for (const op of nodeByNodeId.values()) {
        if (op.node_type !== NodeType.function_start) {
            // eslint-disable-next-line no-continue
            continue;
        }

        operations.push(op);

        op.inputs = (op.input_tensors ?? [])
            .map((id) => nodeByNodeId.get(id))
            .filter((n): n is Node => Boolean(n && n.node_type === NodeType.tensor));

        op.outputs = connected(op)
            .filter((n) => n.node_type === NodeType.function_end)
            .flatMap((end) => connected(end))
            .filter((n): n is Node => n.node_type === NodeType.tensor);
    }

    return operations;
};
