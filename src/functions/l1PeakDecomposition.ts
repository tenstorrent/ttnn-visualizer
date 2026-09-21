// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NO_CONSUMER_OPERATION_ID } from './lateDeallocation';
import { Buffer, Node, NodeType } from '../model/APIData';
import { BufferType, StringBufferType } from '../model/BufferType';
import { L1_NUM_CORES } from '../definitions/L1MemorySize';

/**
 * Buffer types that take space in a core's L1, as opposed to DRAM or host memory.
 * Used for the post-op snapshot, whose `buffer_type` is a real column.
 */
const L1_RESIDENT_BUFFER_TYPES: ReadonlySet<BufferType> = new Set([BufferType.L1, BufferType.L1_SMALL]);

/**
 * Graph nodes are keyed on `type`, not `buffer_type`. Two of the ten local captures
 * (segformer_encoder, visualizer_db) omit `buffer_type` from every one of their
 * buffer nodes while emitting `type` on all of them, so keying on the numeric field
 * silently reports those reports as having no tensors at all. `processMemoryAllocations`
 * reads `type` for the same reason. Both `L1` and `L1_SMALL` occupy L1; tt-metal spells
 * an L1_SMALL node's `type` as `'L1'` and distinguishes it only via `buffer_type`.
 */
const isL1ResidentNode = (params: { type?: string } | null): boolean =>
    params?.type === StringBufferType.L1 || params?.type === StringBufferType.L1_SMALL;

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
 * Whether a total is a measurement or a ceiling.
 *
 * Summing per-bank bytes assumes the residents share cores. A `buffer_allocate` node
 * carries only `num_cores`, never which cores (#2027), and this module does not yet
 * resolve a CB's `core_range_set`, so *any* two live residents are added without proof
 * that they stack on one core. Only a single resident is therefore exact. An earlier
 * version reserved the ceiling for a mixed CB+tensor peak, which labelled a
 * tensors-only sum `Exact` even though resnet50 spreads 306 of its 538 L1 buffers
 * across 56 of 64 banks.
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
    /** Allocations dropped at THIS operation's boundary because the snapshot had freed them. */
    reconciledAwayCount: number;
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
    /**
     * Last operation that genuinely used the tensor at an address, excluding deallocate
     * calls — build it from `getLastValidConsumer` so staleness means the same thing here
     * as it does behind Buffer Summary's hatching.
     *
     * Addresses are recycled: 160 of resnet50's 226 L1 addresses are used by more than one
     * tensor and one is used by 77, so an entry is the last use of whichever tensor the
     * caller resolved last, not of the tensor currently resident. Staleness is therefore
     * indicative, not authoritative. Tracked in #2029.
     */
    lastUseByAddress: ReadonlyMap<number, number>;
    /**
     * Bank count for the `size / num_cores` fallback when a node omits `max_size_per_bank`.
     * Pass `devices[].l1_num_banks`; it is 120, not 64, on 10x13 grids.
     */
    bankCount?: number;
    /**
     * Per-core L1 budget, i.e. `devices[].worker_l1_size`. Used only to judge whether the
     * result is believable — see `exceedsCapacity`.
     */
    capacityBytes?: number;
}

export interface L1PeakDecompositionResult {
    byOperationId: Map<number, L1PeakDecomposition>;
    /** The highest per-operation peak in the run. */
    peak: L1PeakDecomposition | null;
    /**
     * Allocations dropped across the whole run when reconciling against the snapshot. Not
     * purely "the graph never freed these": a tensor seeded from one snapshot and gone by
     * the next is counted too.
     */
    reconciledAwayCount: number;
    /** The per-core L1 budget the peak was judged against, when the caller supplied one. */
    capacityBytes: number | null;
    /**
     * The peak exceeds the device's own L1, so the replay did not describe reachable state
     * and no figure here should be presented as a measurement.
     *
     * A capture can make this unavoidable. `visualizer_db` files an entire 1,184-operation
     * run under a single `captured_graph` row, gives all 288 of its L1 `buffer_deallocate`
     * nodes a null address, and omits `max_size_per_bank`; with nothing matchable to free
     * and one operation boundary at the very end, the replay accumulates every allocation
     * ever made and reports 324,188,384 B — 216x a bank. `traces_51674_report` is degenerate
     * in a different way. Rather than guess at a repair, say the number is unusable.
     */
    exceedsCapacity: boolean;
}

/** The union of params carried by the memory-bearing graph nodes. */
interface GraphMemoryParams {
    address?: string;
    type?: string;
    buffer_type?: BufferType;
    device_id?: number | string;
    size: string;
    num_cores: string;
    max_size_per_bank?: string;
    globally_allocated?: string;
}

interface ReplayContext {
    /** Bank count used only when a node omits `max_size_per_bank`. */
    bankCount: number;
    /** Addresses an operation both allocates and frees, keyed `operationId:address`. */
    intermediates: ReadonlySet<string>;
}

interface ResidentTensor {
    bytes: number;
    /** Set when the allocating operation also frees it, which a snapshot can never show. */
    intermediate: boolean;
}

const isL1ResidentBuffer = (bufferType: BufferType | undefined): boolean =>
    bufferType !== undefined && L1_RESIDENT_BUFFER_TYPES.has(bufferType);

/**
 * Per-bank bytes. `max_size_per_bank` is absent on some captures, and `num_cores` is
 * `0` (integer in most captures, the string `'0'` in visualizer_db) on a handful of
 * nodes, so neither can be trusted without a fallback. The fallback bank count comes
 * from the device because it is not always 64 — multihost_poc and test_ttnn_moe run
 * 10x13 grids with `l1_num_banks` of 120.
 */
const perBankBytes = (params: GraphMemoryParams, bankCount: number): number => {
    if (params.max_size_per_bank !== undefined) {
        return Number(params.max_size_per_bank);
    }
    const cores = Number(params.num_cores) || bankCount;
    return Number(params.size) / cores;
};

const findIntermediates = (operations: readonly { id: number; device_operations: Node[] }[]): ReadonlySet<string> => {
    const intermediates = new Set<string>();

    for (const operation of operations) {
        const allocatedHere = new Set<number>();

        for (const node of operation.device_operations ?? []) {
            const params = node.params as GraphMemoryParams | null;

            const relevant = params?.address !== undefined && isL1ResidentNode(params);

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
        if (state.circularBuffers.size === 0) {
            return false;
        }
        state.circularBuffers.clear();
        return true;
    }

    if (node.node_type === NodeType.circular_buffer_allocate) {
        // A `globally_allocated` CB is a kernel-side view onto an L1 tensor already
        // counted as a buffer, not a fresh allocation. #1651
        if (Number(params.globally_allocated) === 1 || params.address === undefined) {
            return false;
        }
        state.circularBuffers.set(Number(params.address), Number(params.size));
        return true;
    }

    if (!isL1ResidentNode(params) || params.address === undefined) {
        return false;
    }
    const address = Number(params.address);

    if (node.node_type === NodeType.buffer_allocate) {
        state.tensors.set(address, {
            bytes: perBankBytes(params, context.bankCount),
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
type MeasuredInstant = Omit<L1PeakDecomposition, 'reconciledAwayCount'>;

function measure(
    state: ReplayState,
    operationId: number,
    lastUseByAddress: ReadonlyMap<number, number>,
): MeasuredInstant {
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

        // `getLastValidConsumer` returns NO_CONSUMER_OPERATION_ID for a tensor whose only
        // consumers are deallocate calls. It has no last *use* to be late relative to, so it
        // is not stale — without this guard every such tensor lands in the one class the UI
        // tells people to act on. `lateDeallocation.ts` shipped that bug once already.
        if (lastUse !== null && lastUse > NO_CONSUMER_OPERATION_ID && lastUse < operationId) {
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
        precision:
            state.circularBuffers.size + state.tensors.size > 1 ? L1PeakPrecision.UpperBound : L1PeakPrecision.Exact,
        contributors: contributors.sort((left, right) => right.bytes - left.bytes),
    };
}

/**
 * Replay every operation's captured graph and report, per operation, the tightest
 * instant: total per-bank L1 occupancy split by what it is made of.
 *
 * Circular buffers and intra-op intermediates are a large share of peak L1 across the
 * local report corpus and appear nowhere in the post-op `buffers` table, so a
 * decomposition built from that table alone describes a minority of the peak. #2025
 */
export function buildL1PeakDecomposition({
    operations,
    snapshotByOperationId,
    lastUseByAddress,
    bankCount = L1_NUM_CORES,
    capacityBytes,
}: L1PeakDecompositionParams): L1PeakDecompositionResult {
    const context: ReplayContext = { bankCount, intermediates: findIntermediates(operations) };
    const byOperationId = new Map<number, L1PeakDecomposition>();
    const state: ReplayState = { tensors: new Map(), circularBuffers: new Map() };
    let reconciledAwayCount = 0;
    let peak: L1PeakDecomposition | null = null;

    for (const operation of operations) {
        let tightest: MeasuredInstant | null = null;

        for (const node of operation.device_operations ?? []) {
            if (applyNode(node, state, operation.id, context)) {
                const candidate = measure(state, operation.id, lastUseByAddress);

                if (tightest === null || candidate.totalBytes > tightest.totalBytes) {
                    tightest = candidate;
                }
            }
        }

        // A program's circular buffers stop occupying L1 when it stops executing, so they do
        // not carry into the next operation. The capture says otherwise -- tt-metal emits
        // `circular_buffer_deallocate_all` at the *start of the next program*
        // (`GraphProcessor::track_program`), and real release is tied to `~ProgramImpl` -- but
        // that is bookkeeping, not residency. CB addresses never enter the L1 buffer allocator:
        // each program lays its own out from `base_cb_address`, and
        // `ProgramImpl::validate_circular_buffer_region` guards only the program being prepared
        // against the *live* buffer allocator, never against another program's CBs. Proof from
        // the corpus: resnet50 op 9 allocates a tensor at 724,192, 67,360 B inside the region
        // op 8's CBs nominally still hold. Counting the carry inflated op 9's peak by 687,808 B.
        state.circularBuffers.clear();

        // The snapshot is what actually survived, so anything the graph left live
        // but the snapshot omits was freed without a node.
        const snapshot = snapshotByOperationId.get(operation.id);
        let reconciledAwayHere = 0;

        if (snapshot !== undefined) {
            const survivors = new Map<number, Buffer>();

            for (const buffer of snapshot) {
                if (isL1ResidentBuffer(buffer.buffer_type)) {
                    survivors.set(buffer.address, buffer);
                }
            }

            for (const address of [...state.tensors.keys()]) {
                if (!survivors.has(address)) {
                    state.tensors.delete(address);
                    reconciledAwayHere += 1;
                }
            }

            // A survivor the replay never saw is an allocation the graph dropped; seeding it
            // is how a capture with no usable graph tensors still reports a real figure.
            for (const [address, buffer] of survivors) {
                state.tensors.set(address, { bytes: buffer.size, intermediate: false });
            }
        }

        reconciledAwayCount += reconciledAwayHere;

        // Reconciliation can ADD residents, so an operation that ran no L1 node of its own can
        // still be holding the run's peak. Measuring only inside the node loop dropped 56% of
        // segformer's operations, every one of which had live L1.
        const afterReconciliation = measure(state, operation.id, lastUseByAddress);
        const best =
            tightest === null || afterReconciliation.totalBytes > tightest.totalBytes ? afterReconciliation : tightest;

        if (best.totalBytes > 0) {
            const decomposition: L1PeakDecomposition = { ...best, reconciledAwayCount: reconciledAwayHere };

            byOperationId.set(operation.id, decomposition);

            if (peak === null || decomposition.totalBytes > peak.totalBytes) {
                peak = decomposition;
            }
        }
    }

    return {
        byOperationId,
        peak,
        reconciledAwayCount,
        capacityBytes: capacityBytes ?? null,
        exceedsCapacity: capacityBytes !== undefined && peak !== null && peak.totalBytes > capacityBytes,
    };
}
