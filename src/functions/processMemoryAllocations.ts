// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { DeviceOperationTypes, Node, NodeType } from '../model/APIData';

export type AllocationDetails = {
    id: number;
    name: string | null;
    total_cb: number;
    total_buffer: number;
    total_memory: number;
};

export function processMemoryAllocations(graph: Node[]): {
    peakMemoryLoad: number;
    memoryAllocationList: AllocationDetails[];
} {
    let peakMemoryLoad = 0;
    const memoryAllocationList: AllocationDetails[] = [];
    const curOp: { name: string; id: number }[] = [];
    let totalCb = 0;
    let totalBuffer = 0;

    let i = 1;
    while (i < graph.length) {
        const node = graph[i];
        i += 1;

        if (node.node_type === NodeType.function_start) {
            if (curOp.length === 0) {
                while (i < graph.length) {
                    if (graph[i].node_type === NodeType.buffer && graph[i].params.type === DeviceOperationTypes.L1) {
                        totalBuffer += parseInt(graph[i].params.size, 10);
                        i += 1;
                    } else if (graph[i].node_type === NodeType.tensor) {
                        i += 1;
                    } else {
                        break;
                    }
                }
            }

            const { name } = node.params;
            curOp.push({ name, id: node.id });
        }

        if (node.node_type === NodeType.circular_buffer_allocate) {
            totalCb += parseInt(node.params.size, 10);
        }

        if (node.node_type === NodeType.circular_buffer_deallocate_all) {
            totalCb = 0;
        }

        if (node.node_type === NodeType.buffer_allocate && node.params.type === DeviceOperationTypes.L1) {
            totalBuffer += parseInt(node.params.size, 10);
        }

        if (node.node_type === NodeType.function_end) {
            curOp.pop();
        }

        if (node.node_type === NodeType.buffer_deallocate) {
            const connectionIndex = node.connections ? node.connections[0] : -1;
            if (connectionIndex >= 0 && graph[connectionIndex].params.type === 'L1') {
                totalBuffer -= parseInt(graph[connectionIndex].params.size, 10);
            }
        }

        if (curOp.length > 0) {
            const obj: AllocationDetails = {
                name: curOp[curOp.length - 1].name,
                id: node.id,
                total_cb: totalCb,
                total_buffer: totalBuffer,
                total_memory: totalCb + totalBuffer,
            };
            memoryAllocationList.push(obj);
        }

        peakMemoryLoad = Math.max(peakMemoryLoad, totalCb + totalBuffer);
    }

    return { peakMemoryLoad, memoryAllocationList };
}
