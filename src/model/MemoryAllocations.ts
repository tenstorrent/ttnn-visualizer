// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { NodeType } from './APIData';
import { CoreCoordList } from './CoreCoord';

export type AllocationDetails = {
    id: number;
    name: string | null;
    type: NodeType;
    total_cb: number;
    total_buffer: number;
    total_memory: number;
    deviceId: number;
};

/**
 * One circular-buffer allocation summarised at the moment it landed, so the
 * pressure modal can replay "which CBs contributed to this core" without
 * re-walking the graph.
 */
export type CBAllocationSummary = {
    /** Node id of the originating `circular_buffer_allocate` event. */
    nodeId: number;
    address: number;
    /** Per-core size in bytes (matches the raw `size` field on the node). */
    size: number;
    /** Number of distinct cores the allocation covers (0 if unattributed). */
    numCores: number;
    /** Raw `core_range_set` string from the graph node (for display + reproducibility). */
    coreRangeSet: string;
    /** Expanded cores; empty when the allocation falls into the `'?'` bucket. */
    cores: CoreCoordList;
    /** Op id/name that created the CB, used downstream for color-variance/highlighting. */
    allocateOperationId?: number;
    allocateOperationName?: string;
    /** Devices whose identical allocations were folded into this row; 1 off a mesh. #1844 */
    deviceCount: number;
    /**
     * `true` when the source node had `globally_allocated=1`. These CBs are
     * kernel-side views bound to an existing L1 sharded buffer (the tensor at
     * the same address) rather than fresh allocations. They are intentionally
     * omitted from per-core pressure totals (`byCore`, `maxBytes`,
     * `peakMemoryLoad`) but still surfaced in `allocations` so the renderer
     * can mark them as aliased instead of dropping them entirely. See #1651.
     */
    globallyAllocated: boolean;
};

/**
 * Snapshot of CB pressure for one DeviceOp. Keyed by the innermost open
 * `function_start.id` at the time the snapshot was taken (either at a
 * `circular_buffer_deallocate_all` or, as a fallback, at `function_end` when
 * CBs are still live).
 */
export type CBPressureSnapshot = {
    /** Bytes-per-core, keyed by `"x,y"`. The `'?'` bucket captures unattributed CBs. */
    byCore: Record<string, number>;
    /** Convenience: largest attributed (x,y) value in `byCore`. Excludes `'?'`. */
    maxBytes: number;
    /** Bucket for CB allocations whose `core_range_set` resolved to zero cores. */
    unattributedBytes: number;
    /** Ordered list of CBs that were live when the snapshot was taken. */
    allocations: CBAllocationSummary[];
};

/**
 * A mesh op emits the same CB once per device; only the first earns a row, so the
 * rest are listed here for the renderer to skip. #1844
 */
export type CBDeviceFanout = {
    deviceCountByNodeId: Map<number, number>;
    duplicateNodeIds: Set<number>;
};
