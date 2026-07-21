// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceOperationNode, Node, NodeType } from '../model/APIData';
import { L1_NUM_CORES } from '../definitions/L1MemorySize';
import { StringBufferType } from '../model/BufferType';
import { AllocationDetails, CBAllocationSummary, CBPressureSnapshot } from '../model/MemoryAllocations';
import { getCoresInRangeList } from './math';

export function processMemoryAllocations(
    graph: Node[],
    // _inputs: { id: number; size: number | null }[],
): {
    peakMemoryLoad: number;
    memoryAllocationList: AllocationDetails[];
    cbPressureByOpId: Map<number, CBPressureSnapshot>;
} {
    let peakMemoryLoad = 0;
    const memoryAllocationList: AllocationDetails[] = [];
    const curOpList: { name: string; id: number; deviceId?: string | number }[] = [];
    const cbBytesByCore = new Map<string, number>();
    // Live CB allocations since the last `circular_buffer_deallocate_all` (or
    // since the DeviceOp started, whichever came last). Mirrors `cbBytesByCore`
    // so the snapshot can attribute pressure back to specific CB events.
    let liveCBs: CBAllocationSummary[] = [];
    const cbPressureByOpId = new Map<number, CBPressureSnapshot>();

    const snapshotCBPressure = (opId: number) => {
        if (liveCBs.length === 0 && cbBytesByCore.size === 0) {
            return;
        }
        const byCore: Record<string, number> = {};
        let maxBytes = 0;
        let unattributedBytes = 0;
        for (const [k, v] of cbBytesByCore.entries()) {
            byCore[k] = v;
            if (k === '?') {
                unattributedBytes = v;
            } else if (v > maxBytes) {
                maxBytes = v;
            }
        }
        // Last writer wins if a DeviceOp triggers multiple snapshots. v1
        // assumption: one `circular_buffer_deallocate_all` per DeviceOp.
        cbPressureByOpId.set(opId, {
            byCore,
            maxBytes,
            unattributedBytes,
            allocations: liveCBs.slice(),
        });
    };

    let totalBuffer = 0;

    const maxCbPerCore = (): number => {
        let m = 0;
        // Skip the '?' bucket — those bytes have no core attribution so
        // they don't belong in a per-core peak. Mirrors the same exclusion
        // in snapshotCBPressure() so cbPeak and snapshot.maxBytes agree.
        for (const [k, v] of cbBytesByCore.entries()) {
            if (k !== '?' && v > m) {
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
            // `globally_allocated='1'` CBs are views into an existing L1
            // sharded buffer (the tensor at the same address), not fresh
            // allocations. Their bytes are already counted in `totalBuffer`;
            // folding them into `cbBytesByCore` would double-count them in
            // both `peakMemoryLoad` and the per-DeviceOp snapshot. Keep the
            // row in `liveCBs` so the modal can still surface and label them.
            // Accepts both the on-wire string form and a numeric form for
            // forward-compat with future tt-metal emit changes. #1651
            const rawGlobalFlag = node.params.globally_allocated as unknown;
            const globallyAllocated = rawGlobalFlag === '1' || rawGlobalFlag === 1;
            if (!globallyAllocated) {
                if (cores.length === 0) {
                    cbBytesByCore.set('?', (cbBytesByCore.get('?') ?? 0) + size);
                } else {
                    for (const { x, y } of cores) {
                        const k = `${x},${y}`;
                        cbBytesByCore.set(k, (cbBytesByCore.get(k) ?? 0) + size);
                    }
                }
            }
            liveCBs.push({
                nodeId: node.id,
                address: parseInt(node.params.address, 10),
                size,
                numCores: cores.length,
                coreRangeSet: node.params.core_range_set,
                cores,
                allocateOperationId: currentOp?.id,
                allocateOperationName: currentOp?.name,
                globallyAllocated,
            });
        }

        if (node.node_type === NodeType.circular_buffer_deallocate_all) {
            // Snapshot before clearing so the modal can recreate the pressure
            // state seen by the just-completed kernel. Attribute to the
            // innermost open function_start — that's the DeviceOp whose CBs
            // are being released.
            if (currentOp) {
                snapshotCBPressure(currentOp.id);
            }
            cbBytesByCore.clear();
            liveCBs = [];
        }

        if (node.node_type === NodeType.buffer_allocate && node.params.type === StringBufferType.L1) {
            const numCores = parseInt(node.params.num_cores, 10) || L1_NUM_CORES;
            const totalSize = parseInt(node.params.size, 10);
            totalBuffer += totalSize / numCores;
        }

        if (node.node_type === NodeType.function_end) {
            // Safety net: well-behaved DeviceOps end with
            // `circular_buffer_deallocate_all`, but if a kernel exits with CBs
            // still live, attribute the lingering pressure to the closing op
            // before unwinding the stack.
            const ending = curOpList[curOpList.length - 1];
            if (ending && liveCBs.length > 0 && !cbPressureByOpId.has(ending.id)) {
                snapshotCBPressure(ending.id);
            }
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

    return { peakMemoryLoad, memoryAllocationList, cbPressureByOpId };
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
