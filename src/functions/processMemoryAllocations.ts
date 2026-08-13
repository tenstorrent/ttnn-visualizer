// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { DeviceOperationNode, Node, NodeType } from '../model/APIData';
import { L1_NUM_CORES } from '../definitions/L1MemorySize';
import { StringBufferType } from '../model/BufferType';
import { AllocationDetails, CBAllocationSummary, CBDeviceFanout, CBPressureSnapshot } from '../model/MemoryAllocations';
import { getCoresInRangeList } from './math';

// Stands in for `device_id` when the graph omits it, so a report with no device
// dimension accumulates into one bucket exactly as it did before #1844.
const SINGLE_DEVICE_KEY = 'single';

export function processMemoryAllocations(
    graph: Node[],
    // _inputs: { id: number; size: number | null }[],
): {
    peakMemoryLoad: number;
    memoryAllocationList: AllocationDetails[];
    cbPressureByOpId: Map<number, CBPressureSnapshot>;
    cbFanout: CBDeviceFanout;
} {
    let peakMemoryLoad = 0;
    const memoryAllocationList: AllocationDetails[] = [];
    const curOpList: { name: string; id: number; deviceId?: string | number }[] = [];
    // Keyed `${device}|${x},${y}` because core (0,0) of device 0 is not core
    // (0,0) of device 6; summing the mesh's identical CBs is what inflated every
    // total by the device count. #1844
    const cbBytesByDeviceCore = new Map<string, number>();
    // CBs whose `core_range_set` resolved to no cores, per device.
    const unattributedByDevice = new Map<string, number>();
    // Live CB allocations since the last `circular_buffer_deallocate_all` (or
    // since the DeviceOp started, whichever came last), one entry per CB rather
    // than per device. Mirrors `cbBytesByDeviceCore` so the snapshot can
    // attribute pressure back to specific CB events.
    let liveCBs: CBAllocationSummary[] = [];
    // Lets a later device bump an existing CB's `deviceCount` instead of adding
    // a row. Same lifetime as `liveCBs`.
    let liveCBByIdentity = new Map<string, { summary: CBAllocationSummary; deviceKeys: Set<string> }>();
    const cbPressureByOpId = new Map<number, CBPressureSnapshot>();
    const cbFanout: CBDeviceFanout = {
        deviceCountByNodeId: new Map<number, number>(),
        duplicateNodeIds: new Set<number>(),
    };

    const resetLiveCBs = () => {
        liveCBs = [];
        liveCBByIdentity = new Map();
    };

    const snapshotCBPressure = (opId: number) => {
        if (liveCBs.length === 0 && cbBytesByDeviceCore.size === 0 && unattributedByDevice.size === 0) {
            return;
        }
        const byCore: Record<string, number> = {};
        let maxBytes = 0;
        for (const [key, bytes] of cbBytesByDeviceCore.entries()) {
            const core = key.slice(key.indexOf('|') + 1);
            const perCore = Math.max(byCore[core] ?? 0, bytes);
            byCore[core] = perCore;
            if (perCore > maxBytes) {
                maxBytes = perCore;
            }
        }
        let unattributedBytes = 0;
        for (const bytes of unattributedByDevice.values()) {
            unattributedBytes = Math.max(unattributedBytes, bytes);
        }
        if (unattributedByDevice.size > 0) {
            byCore['?'] = unattributedBytes;
        }
        // Copied per entry because `deviceCount` stays mutable on the live
        // objects; a snapshot must not change after it is taken.
        cbPressureByOpId.set(opId, {
            byCore,
            maxBytes,
            unattributedBytes,
            allocations: liveCBs.map((cb) => ({ ...cb })),
        });
    };

    let totalBuffer = 0;

    const maxCbPerCore = (): number => {
        let m = 0;
        // Unattributed bytes are excluded — they have no core attribution so
        // they don't belong in a per-core peak. Mirrors the same exclusion
        // in snapshotCBPressure() so cbPeak and snapshot.maxBytes agree.
        for (const bytes of cbBytesByDeviceCore.values()) {
            if (bytes > m) {
                m = bytes;
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
            const deviceKey = String(node.params.device_id ?? SINGLE_DEVICE_KEY);
            if (!globallyAllocated) {
                if (cores.length === 0) {
                    unattributedByDevice.set(deviceKey, (unattributedByDevice.get(deviceKey) ?? 0) + size);
                } else {
                    for (const { x, y } of cores) {
                        const k = `${deviceKey}|${x},${y}`;
                        cbBytesByDeviceCore.set(k, (cbBytesByDeviceCore.get(k) ?? 0) + size);
                    }
                }
            }

            const address = parseInt(node.params.address, 10);
            const identity = `${address}|${size}|${node.params.core_range_set}|${globallyAllocated}`;
            const existing = liveCBByIdentity.get(identity);
            // A repeat within one device is a genuine second allocation, not mesh
            // fan-out, so it keeps its own row.
            if (existing && !existing.deviceKeys.has(deviceKey)) {
                existing.deviceKeys.add(deviceKey);
                existing.summary.deviceCount = existing.deviceKeys.size;
                cbFanout.deviceCountByNodeId.set(existing.summary.nodeId, existing.deviceKeys.size);
                cbFanout.duplicateNodeIds.add(node.id);
            } else {
                const summary: CBAllocationSummary = {
                    nodeId: node.id,
                    address,
                    size,
                    numCores: cores.length,
                    coreRangeSet: node.params.core_range_set,
                    cores,
                    allocateOperationId: currentOp?.id,
                    allocateOperationName: currentOp?.name,
                    globallyAllocated,
                    deviceCount: 1,
                };
                liveCBs.push(summary);
                liveCBByIdentity.set(identity, { summary, deviceKeys: new Set([deviceKey]) });
                cbFanout.deviceCountByNodeId.set(node.id, 1);
            }
        }

        if (node.node_type === NodeType.circular_buffer_deallocate_all) {
            // Snapshot before clearing so the modal can recreate the pressure
            // state seen by the just-completed kernel. Attribute to the
            // innermost open function_start — that's the DeviceOp whose CBs
            // are being released.
            if (currentOp) {
                snapshotCBPressure(currentOp.id);
            }
            cbBytesByDeviceCore.clear();
            unattributedByDevice.clear();
            resetLiveCBs();
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

    return { peakMemoryLoad, memoryAllocationList, cbPressureByOpId, cbFanout };
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
