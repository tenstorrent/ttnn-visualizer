// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { DeviceOperationTypes, Node, NodeType } from '../model/APIData';

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
    inputs: { id: number; size: number | null }[],
): {
    peakMemoryLoad: number;
    memoryAllocationList: AllocationDetails[];
} {
    let peakMemoryLoad = 0;
    const memoryAllocationList: AllocationDetails[] = [];
    const curOp: { name: string; id: number; deviceId?: string | number }[] = [];
    let totalCb = 0;
    let totalBuffer = 0;

    let i = 1;
    while (i < graph.length) {
        const node = graph[i];
        i += 1;
        if (node.node_type === NodeType.function_start) {
            if (node.inputs?.length > 0) {
                // eslint-disable-next-line no-loop-func
                node.inputs.forEach((tensor) => {
                    const size = inputs.find((x) => x.id === parseInt(String(tensor.params.tensor_id), 10))?.size;
                    if (size !== null && size !== undefined) {
                        totalBuffer += size;
                    }
                    // this is the 'original' math, shoudl stay for a bit
                    //                 const tensor = graph[id];
                    //                 if (tensor.node_type === NodeType.tensor) {
                    //                     console.log('tensor', tensor.params.tensor_id);
                    //
                    //                     const size = inputs.find(
                    //                         (x) => x.id === parseInt(String(tensor.params.tensor_id), 10),
                    //                     )?.size;
                    //                     console.log('found size', size);
                    //                     if (size !== null && size !== undefined) {
                    //                         totalBuffer += size;
                    //                     }
                    //                 }
                    //             });
                });
            }

            const { name } = node.params;
            curOp.push({ name, id: node.id, deviceId: node.params.device_id });
        }

        if (node.params.device_id !== undefined && curOp.length > 1) {
            curOp[curOp.length - 1].deviceId = node.params.device_id;
        }

        if (node.node_type === NodeType.circular_buffer_allocate) {
            totalCb += parseInt(node.params.size, 10);
        }

        if (node.node_type === NodeType.circular_buffer_deallocate_all) {
            totalCb = 0;
        }

        if (node.node_type === NodeType.buffer_allocate && node.params.type === DeviceOperationTypes.L1) {
            const numCores = parseInt(node.params.num_cores, 10) || 1;
            const totalSize = parseInt(node.params.size, 10);
            totalBuffer += totalSize / numCores;
        }

        if (node.node_type === NodeType.function_end) {
            curOp.pop();
        }

        if (node.node_type === NodeType.buffer_deallocate) {
            const connectionIndex = node.connections ? node.connections[0] : -1;
            const connectedNode = graph[connectionIndex];
            if (connectionIndex >= 0 && connectedNode && connectedNode.params.type === 'L1') {
                const numCores = parseInt(node.params.num_cores, 10) || 1;
                const size = parseInt(node.params.size, 10) / numCores;
                totalBuffer -= size;
            }
        }

        if (curOp.length > 0) {
            const obj: AllocationDetails = {
                name: curOp[curOp.length - 1].name,
                deviceId: curOp[curOp.length - 1].deviceId as number,
                id: node.id,
                type: node.node_type,
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
