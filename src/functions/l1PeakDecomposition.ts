// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Buffer, Node, NodeType } from '../model/APIData';
import { BufferType } from '../model/BufferType';
import { L1_NUM_CORES } from '../definitions/L1MemorySize';

/** Buffer types that take space in a core's L1, as opposed to DRAM or host memory. */
const L1_RESIDENT_BUFFER_TYPES: ReadonlySet<BufferType> = new Set([BufferType.L1, BufferType.L1_SMALL]);

/** What a resident is, which decides whether anything can be done about it. */
export enum L1ResidentKind {
    CircularBuffer = 'circular-buffer',
    /** Allocated and freed inside one operation — never visible in a post-op snapshot. */
    IntermediateTensor = 'intermediate-tensor',
    PersistentTensor = 'persistent-tensor',
    /** Still allocated after its last real consumer; the only freeable class. */
    StaleTensor = 'stale-tensor',
}

/**
 * Whether a total is a measurement or a ceiling. A CB carries a `core_range_set`,
 * but a `buffer_allocate` node carries only `num_cores`, so when both classes are
 * resident we cannot prove they share cores and can only add their per-bank bytes.
 * #2027
 */
export enum L1PeakPrecision {
    Exact = 'exact',
    UpperBound = 'upper-bound',
}

export interface L1PeakContributor {
    address: number;
    /** Per-bank bytes, the same unit as `Buffer.size` and `max_size_per_bank`. */
    bytes: number;
    kind: L1ResidentKind;
    /** Last operation that genuinely consumed the tensor; null for CBs and unknowns. */
    lastUsedByOperationId: number | null;
}

export interface L1PeakDecomposition {
    operationId: number;
    totalBytes: number;
    circularBufferBytes: number;
    intermediateTensorBytes: number;
    persistentTensorBytes: number;
    staleTensorBytes: number;
    precision: L1PeakPrecision;
    contributors: readonly L1PeakContributor[];
}

export interface L1PeakDecompositionParams {
    /** Operations in execution order, each carrying its captured graph. */
    operations: readonly { id: number; device_operations: Node[] }[];
    /**
     * Post-op L1 residents per operation id. Ground truth for what survives an
     * operation: the captured graph emits fewer `buffer_deallocate` nodes than
     * `buffer_allocate` ones (517 vs 255 on resnet50), so a graph-only replay
     * accumulates allocations that were in fact freed. #2025
     */
    snapshotByOperationId: ReadonlyMap<number, readonly Buffer[]>;
    /** Last operation that genuinely used the tensor at an address, excluding deallocate calls. */
    lastUseByAddress: ReadonlyMap<number, number>;
    /** Which device to account for; null accounts for every node, for single-device reports. */
    deviceId: number | null;
}

export interface L1PeakDecompositionResult {
    byOperationId: Map<number, L1PeakDecomposition>;
    /** The highest per-operation peak in the run. */
    peak: L1PeakDecomposition | null;
    /** Allocations the graph never freed, dropped when reconciling against the snapshot. */
    reconciledAwayCount: number;
}

/** The union of params carried by the memory-bearing graph nodes. */
interface GraphMemoryParams {
    address?: string;
    buffer_type?: BufferType;
    device_id?: number | string;
    size: string;
    num_cores: string;
    max_size_per_bank?: string;
    globally_allocated?: string;
}

interface ReplayContext {
    deviceId: number | null;
    /** Addresses an operation both allocates and frees, keyed `operationId:address`. */
    intermediates: ReadonlySet<string>;
}

interface ResidentTensor {
    bytes: number;
    /** Set when the allocating operation also frees it, which a snapshot can never show. */
    intermediate: boolean;
}

/**
 * tt-metal emits `device_id` as a number in some captures and a string in others,
 * and omits it entirely in older ones. #1844
 */
const matchesDevice = (raw: number | string | undefined, deviceId: number | null): boolean => {
    if (deviceId === null || raw === undefined) {
        return true;
    }
    return Number(raw) === deviceId;
};

const isL1Resident = (bufferType: BufferType | undefined): boolean =>
    bufferType !== undefined && L1_RESIDENT_BUFFER_TYPES.has(bufferType);

/**
 * Per-bank bytes. `max_size_per_bank` is absent on some captures, and `num_cores`
 * is `'0'` on a handful of nodes, so neither can be trusted without a fallback.
 */
const perBankBytes = (params: GraphMemoryParams): number => {
    if (params.max_size_per_bank !== undefined) {
        return Number(params.max_size_per_bank);
    }
    const cores = Number(params.num_cores) || L1_NUM_CORES;
    return Number(params.size) / cores;
};

const findIntermediates = (
    operations: readonly { id: number; device_operations: Node[] }[],
    deviceId: number | null,
): ReadonlySet<string> => {
    const intermediates = new Set<string>();

    for (const operation of operations) {
        const allocatedHere = new Set<number>();

        for (const node of operation.device_operations ?? []) {
            const params = node.params as GraphMemoryParams | null;

            const relevant =
                params !== null &&
                params !== undefined &&
                params.address !== undefined &&
                isL1Resident(params.buffer_type) &&
                matchesDevice(params.device_id, deviceId);

            if (relevant && node.node_type === NodeType.buffer_allocate) {
                allocatedHere.add(Number(params.address));
            } else if (relevant && node.node_type === NodeType.buffer_deallocate) {
                const address = Number(params.address);

                if (allocatedHere.has(address)) {
                    intermediates.add(`${operation.id}:${address}`);
                }
            }
        }
    }

    return intermediates;
};

/**
 * Replay every operation's captured graph and report, per operation, the tightest
 * instant: total per-bank L1 occupancy split by what it is made of.
 *
 * Circular buffers are 46–100% of peak L1 across the local report corpus, and
 * intra-op intermediates a further 32–38% on resnet50, so a decomposition built
 * from the post-op `buffers` table alone would describe a minority of the peak.
 * #2025
 */
interface ReplayState {
    tensors: Map<number, ResidentTensor>;
    circularBuffers: Map<number, number>;
}

/**
 * Apply one graph node to the live state. Returns whether it changed occupancy,
 * so the caller only measures at the instants that can move the peak.
 */
function applyNode(node: Node, state: ReplayState, operationId: number, context: ReplayContext): boolean {
    // `capture_start` and `capture_end` carry a null `params`.
    const params = node.params as GraphMemoryParams | null;

    if (params === null || params === undefined) {
        return false;
    }

    if (node.node_type === NodeType.circular_buffer_deallocate_all) {
        if (!matchesDevice(params.device_id, context.deviceId) || state.circularBuffers.size === 0) {
            return false;
        }
        state.circularBuffers.clear();
        return true;
    }

    if (!matchesDevice(params.device_id, context.deviceId)) {
        return false;
    }

    if (node.node_type === NodeType.circular_buffer_allocate) {
        // A `globally_allocated` CB is a kernel-side view onto an L1 tensor already
        // counted as a buffer, not a fresh allocation. #1651
        if (params.globally_allocated === '1' || Number(params.globally_allocated) === 1) {
            return false;
        }
        state.circularBuffers.set(Number(params.address), Number(params.size));
        return true;
    }

    if (!isL1Resident(params.buffer_type) || params.address === undefined) {
        return false;
    }
    const address = Number(params.address);

    if (node.node_type === NodeType.buffer_allocate) {
        state.tensors.set(address, {
            bytes: perBankBytes(params),
            intermediate: context.intermediates.has(`${operationId}:${address}`),
        });
        return true;
    }

    if (node.node_type === NodeType.buffer_deallocate) {
        return state.tensors.delete(address);
    }

    return false;
}

/** Occupancy at one instant, split by what a user could do about each part. */
function measure(state: ReplayState, operationId: number, lastUseByAddress: ReadonlyMap<number, number>) {
    const contributors: L1PeakContributor[] = [];
    let circularBufferBytes = 0;
    let intermediateTensorBytes = 0;
    let persistentTensorBytes = 0;
    let staleTensorBytes = 0;

    for (const [address, bytes] of state.circularBuffers) {
        circularBufferBytes += bytes;
        contributors.push({ address, bytes, kind: L1ResidentKind.CircularBuffer, lastUsedByOperationId: null });
    }

    for (const [address, tensor] of state.tensors) {
        const lastUse = lastUseByAddress.get(address) ?? null;
        let kind: L1ResidentKind;

        if (lastUse !== null && lastUse < operationId) {
            kind = L1ResidentKind.StaleTensor;
            staleTensorBytes += tensor.bytes;
        } else if (tensor.intermediate) {
            kind = L1ResidentKind.IntermediateTensor;
            intermediateTensorBytes += tensor.bytes;
        } else {
            kind = L1ResidentKind.PersistentTensor;
            persistentTensorBytes += tensor.bytes;
        }

        contributors.push({ address, bytes: tensor.bytes, kind, lastUsedByOperationId: lastUse });
    }

    return {
        operationId,
        totalBytes: circularBufferBytes + intermediateTensorBytes + persistentTensorBytes + staleTensorBytes,
        circularBufferBytes,
        intermediateTensorBytes,
        persistentTensorBytes,
        staleTensorBytes,
        // Two classes of resident can only be added, not reconciled, without
        // knowing whether they share cores.
        precision:
            state.circularBuffers.size > 0 && state.tensors.size > 0
                ? L1PeakPrecision.UpperBound
                : L1PeakPrecision.Exact,
        contributors: contributors.sort((left, right) => right.bytes - left.bytes),
    };
}

/**
 * Replay every operation's captured graph and report, per operation, the tightest
 * instant: total per-bank L1 occupancy split by what it is made of.
 *
 * Circular buffers are 46-100% of peak L1 across the local report corpus, and
 * intra-op intermediates a further 32-38% on resnet50, so a decomposition built
 * from the post-op `buffers` table alone would describe a minority of the peak.
 * #2025
 */
export function buildL1PeakDecomposition({
    operations,
    snapshotByOperationId,
    lastUseByAddress,
    deviceId,
}: L1PeakDecompositionParams): L1PeakDecompositionResult {
    const context: ReplayContext = { deviceId, intermediates: findIntermediates(operations, deviceId) };
    const byOperationId = new Map<number, L1PeakDecomposition>();
    const state: ReplayState = { tensors: new Map(), circularBuffers: new Map() };
    let reconciledAwayCount = 0;
    let peak: L1PeakDecomposition | null = null;

    for (const operation of operations) {
        let tightest: L1PeakDecomposition | null = null;

        for (const node of operation.device_operations ?? []) {
            if (applyNode(node, state, operation.id, context)) {
                const candidate = measure(state, operation.id, lastUseByAddress);

                if (tightest === null || candidate.totalBytes > tightest.totalBytes) {
                    tightest = candidate;
                }
            }
        }

        if (tightest !== null) {
            byOperationId.set(operation.id, tightest);

            if (peak === null || tightest.totalBytes > peak.totalBytes) {
                peak = tightest;
            }
        }

        // The snapshot is what actually survived, so anything the graph left live
        // but the snapshot omits was freed without a node.
        const snapshot = snapshotByOperationId.get(operation.id);

        if (snapshot !== undefined) {
            const survivors = new Map<number, Buffer>();

            for (const buffer of snapshot) {
                if (isL1Resident(buffer.buffer_type) && matchesDevice(buffer.device_id, deviceId)) {
                    survivors.set(buffer.address, buffer);
                }
            }

            for (const address of [...state.tensors.keys()]) {
                if (!survivors.has(address)) {
                    state.tensors.delete(address);
                    reconciledAwayCount += 1;
                }
            }

            for (const [address, buffer] of survivors) {
                state.tensors.set(address, { bytes: buffer.size, intermediate: false });
            }
        }
    }

    return { byOperationId, peak, reconciledAwayCount };
}
