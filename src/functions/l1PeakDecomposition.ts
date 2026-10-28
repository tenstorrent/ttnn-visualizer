// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { NO_CONSUMER_OPERATION_ID, getLastValidConsumer } from './lateDeallocation';
import { L1PeakPrecision, L1ResidentKind } from '../definitions/L1PeakDecomposition';
import {
    L1PeakContributor,
    L1PeakDecomposition,
    L1PeakDecompositionParams,
    L1PeakDecompositionResult,
} from '../model/L1PeakDecomposition';
import { Buffer, Node, NodeType, OperationDescription, Tensor } from '../model/APIData';
import { BufferType, isL1BufferType, isL1StringBufferType } from '../model/BufferType';
import { L1_NUM_CORES } from '../definitions/L1MemorySize';

const addressOf = (params: GraphMemoryParams | null): number | null => {
    if (params?.address === undefined || params.address === null) {
        return null;
    }
    const address = Number(params.address);

    return Number.isFinite(address) ? address : null;
};

/**
 * Graph nodes are keyed on `type`, not `buffer_type`. Two of the ten local captures
 * (segformer_encoder, visualizer_db) omit `buffer_type` from every one of their
 * buffer nodes while emitting `type` on all of them, so keying on the numeric field
 * silently reports those reports as having no tensors at all. `processMemoryAllocations`
 * reads `type` for the same reason. Both `L1` and `L1_SMALL` occupy L1; tt-metal spells
 * an L1_SMALL node's `type` as `'L1'` and distinguishes it only via `buffer_type`.
 */
const isL1ResidentNode = (params: { type?: string } | null): boolean => isL1StringBufferType(params?.type);

/** The union of params carried by the memory-bearing graph nodes. */
interface GraphMemoryParams {
    /**
     * Null on 276 of segformer's and 288 of visualizer_db's L1 deallocate nodes. `Number(null)`
     * is 0 and `null !== undefined`, so a guard that only rejects `undefined` lets a null
     * through as address 0 — and traces_51674 has eight real buffers there.
     */
    address?: string | null;
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
        // Keyed by occurrence, not by address: `allocate(A) free(A) allocate(A)` within one
        // operation leaves the SECOND allocation live, and an operation-wide flag would call
        // that survivor intermediate. Two counters, because the occurrence number has to be the
        // one `applyNode` will compute: `allocationsSeen` only ever climbs, while the live entry
        // is dropped on free. Counting down a single counter instead reissues occurrence 1 to the
        // second allocation of `allocate free allocate free`, so the replay's occurrence 2 misses
        // the set and a tensor freed inside the operation is billed as persistent. resnet50 does
        // this 12 times, including 1,360,480 at operation 8.
        const allocationsSeen = new Map<number, number>();
        const liveOccurrence = new Map<number, number>();

        operation.device_operations?.forEach((node) => {
            const params = node.params as GraphMemoryParams | null;

            const address = isL1ResidentNode(params) ? addressOf(params) : null;

            if (address === null) {
                return;
            }
            if (node.node_type === NodeType.buffer_allocate) {
                const occurrence = (allocationsSeen.get(address) ?? 0) + 1;

                allocationsSeen.set(address, occurrence);
                // Last allocation wins, mirroring `state.tensors`, which is also keyed by address.
                liveOccurrence.set(address, occurrence);
            } else if (node.node_type === NodeType.buffer_deallocate) {
                const occurrence = liveOccurrence.get(address);

                if (occurrence !== undefined) {
                    intermediates.add(`${operation.id}:${address}:${occurrence}`);
                    liveOccurrence.delete(address);
                }
            }
        });
    }

    return intermediates;
};

interface ReplayState {
    tensors: Map<number, ResidentTensor>;
    circularBuffers: Map<number, number>;
    /** Allocations per address within the current operation, to match `findIntermediates`. */
    allocationsSeen: Map<number, number>;
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
        const cbAddress = addressOf(params);

        if (Number(params.globally_allocated) === 1 || cbAddress === null) {
            return false;
        }
        state.circularBuffers.set(cbAddress, Number(params.size));
        return true;
    }

    const address = isL1ResidentNode(params) ? addressOf(params) : null;

    if (address === null) {
        return false;
    }

    if (node.node_type === NodeType.buffer_allocate) {
        const occurrence = (state.allocationsSeen.get(address) ?? 0) + 1;

        state.allocationsSeen.set(address, occurrence);
        state.tensors.set(address, {
            bytes: perBankBytes(params, context.bankCount),
            intermediate: context.intermediates.has(`${operationId}:${address}:${occurrence}`),
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
        contributors.push({ address, bytes, kind: L1ResidentKind.CIRCULAR_BUFFER, lastUsedByOperationId: null });
    }

    for (const [address, tensor] of state.tensors) {
        const lastUse = lastUseByAddress.get(address) ?? null;
        let kind: L1ResidentKind;

        // Intermediate first, because the two claims are not equally well founded. This
        // operation's graph shows it allocating and freeing this exact occurrence, while
        // `lastUse` is inferred from a *different* tensor that once sat at this address:
        // `resolveAddressLifetimes` reads operation inputs and outputs, where an intra-op
        // scratch buffer never appears. Checking staleness first let the older tensor's
        // lifetime win and filed a buffer this operation frees itself under the one class
        // the UI tells people to go and act on.
        if (tensor.intermediate) {
            kind = L1ResidentKind.INTERMEDIATE_TENSOR;
            intermediateTensorBytes += tensor.bytes;
            // `getLastValidConsumer` returns NO_CONSUMER_OPERATION_ID for a tensor whose only
            // consumers are deallocate calls. It has no last *use* to be late relative to, so it
            // is not stale — without this guard every such tensor lands in the one class the UI
            // tells people to act on. `lateDeallocation.ts` shipped that bug once already.
        } else if (lastUse !== null && lastUse > NO_CONSUMER_OPERATION_ID && lastUse < operationId) {
            kind = L1ResidentKind.STALE_TENSOR;
            staleTensorBytes += tensor.bytes;
        } else {
            kind = L1ResidentKind.PERSISTENT_TENSOR;
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
            state.circularBuffers.size + state.tensors.size > 1 ? L1PeakPrecision.UPPER_BOUND : L1PeakPrecision.EXACT,
        contributors,
    };
}

interface AddressLifetimes {
    lastUseByAddress: Map<number, number>;
    unattributableStaleAddressCount: number;
}

/**
 * Last real use per address, for the addresses where that question has one answer.
 *
 * An address outlives the tensor that used it — resnet50 reuses 1,413,632 across 40 tensors —
 * so for a shared address there is no way to say which lifetime the resident belongs to.
 * Collapsing them (this previously took the maximum) does not hide the problem, it picks a
 * side: the maximum silently reclassifies genuinely stale residents as persistent, masking
 * 478 operation-slots on resnet50 against the 9 it reports. Leaving a shared address
 * unclassified makes the stale figure a floor instead, which is a claim the data supports.
 * #2029
 * Mirrored as `resolve_address_lifetimes` in `backend/ttnn_visualizer/agent/l1_peak.py`.
 */
export const resolveAddressLifetimes = (operations: readonly OperationDescription[]): AddressLifetimes => {
    const operationNamesById = new Map<number, string>(operations.map((operation) => [operation.id, operation.name]));
    const lastUseByTensorId = new Map<number, { address: number; lastUse: number }>();

    const consider = (tensor: Tensor) => {
        if (tensor.address === null || !isL1BufferType(tensor.buffer_type)) {
            return;
        }
        // Same definition of "a real use" as the late-deallocation overlay, so the two views
        // cannot disagree about what counts as a use — only, per the above, about attribution.
        const { lastConsumerOperationId } = getLastValidConsumer(tensor.consumers, operationNamesById);

        lastUseByTensorId.set(tensor.id, { address: tensor.address, lastUse: lastConsumerOperationId });
    };

    operations.forEach((operation) => {
        operation.inputs?.forEach(consider);
        operation.outputs?.forEach(consider);
    });

    const byAddress = new Map<number, number[]>();

    lastUseByTensorId.forEach(({ address, lastUse }) => {
        const existing = byAddress.get(address);

        if (existing) {
            existing.push(lastUse);
        } else {
            byAddress.set(address, [lastUse]);
        }
    });

    const lastUseByAddress = new Map<number, number>();
    let unattributableStaleAddressCount = 0;

    byAddress.forEach((lastUses, address) => {
        // A tensor whose only consumers are deallocate calls has no last use to be late
        // relative to, and contributes no lifetime rather than an early one.
        const real = lastUses.filter((lastUse) => lastUse > NO_CONSUMER_OPERATION_ID);

        if (real.length === 1) {
            lastUseByAddress.set(address, real[0]);
        } else if (real.length > 1) {
            unattributableStaleAddressCount += 1;
        }
    });

    return { lastUseByAddress, unattributableStaleAddressCount };
};

/**
 * Replay every operation's captured graph and report, per operation, the tightest
 * instant: total per-bank L1 occupancy split by what it is made of.
 *
 * Circular buffers and intra-op intermediates are a large share of peak L1 across the
 * local report corpus and appear nowhere in the post-op `buffers` table, so a
 * decomposition built from that table alone describes a minority of the peak. #2025
 * Mirrored as `build_l1_peak` in `backend/ttnn_visualizer/agent/l1_peak.py`.
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
    const state: ReplayState = { tensors: new Map(), circularBuffers: new Map(), allocationsSeen: new Map() };
    let reconciledAwayCount = 0;
    let peak: L1PeakDecomposition | null = null;

    for (const operation of operations) {
        state.allocationsSeen.clear();

        // Seeded from the state the operation is entered with: residents carried from the
        // previous snapshot are live before the first node runs, so an operation whose first
        // node is a free would otherwise never have its tightest instant measured.
        let tightest: MeasuredInstant | null = measure(state, operation.id, lastUseByAddress);

        for (const node of operation.device_operations ?? []) {
            if (applyNode(node, state, operation.id, context)) {
                const candidate = measure(state, operation.id, lastUseByAddress);

                if (tightest === null || candidate.totalBytes > tightest.totalBytes) {
                    tightest = candidate;
                }
            }
        }

        // The snapshot is what actually survived, so anything the graph left live
        // but the snapshot omits was freed without a node.
        const snapshot = snapshotByOperationId.get(operation.id);
        let reconciledAwayHere = 0;

        if (snapshot !== undefined) {
            const survivors = new Map<number, Buffer>();

            for (const buffer of snapshot) {
                // The post-op snapshot's `buffer_type` is a real column, unlike a graph node's.
                if (isL1BufferType(buffer.buffer_type)) {
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

        const best =
            tightest === null || afterReconciliation.totalBytes > tightest.totalBytes ? afterReconciliation : tightest;

        {
            const decomposition: L1PeakDecomposition = {
                ...best,
                // Sorted here rather than inside `measure`: only the winning instant's order is
                // ever read, and `measure` runs once per state-changing node.
                contributors: [...best.contributors].sort((left, right) => right.bytes - left.bytes),
                reconciledAwayCount: reconciledAwayHere,
            };

            byOperationId.set(operation.id, decomposition);

            // Strictly greater, so the peak names the FIRST operation to reach it. Ties are the
            // norm, not an edge case: resnet50_aug06 reaches its peak at both 146 and 257, and
            // segformer at both 219 and 283.
            if (decomposition.totalBytes > 0 && (peak === null || decomposition.totalBytes > peak.totalBytes)) {
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

/** Larger first. NaN orders against nothing, so it is put last rather than left to the sort. */
const compareTotalsDescending = (left: number, right: number): number => {
    if (Number.isNaN(left) || Number.isNaN(right)) {
        return Number(Number.isNaN(left)) - Number(Number.isNaN(right));
    }

    // Compared rather than subtracted: `Infinity - Infinity` is NaN.
    if (left === right) {
        return 0;
    }

    return left > right ? -1 : 1;
};

export interface L1PeakTopOperation<T extends L1PeakDecomposition> {
    entry: T;
    /** The later operations with the same composition, in the order they rank. */
    alsoAt: number[];
}

/**
 * The largest operations, one per distinct composition, ties broken by lower id.
 *
 * resnet50 runs the same layer stack three times, so an undeduped ranking spends every row
 * on one loop body — operations 130 and 229 are byte-identical. The first occurrence of each
 * composition is kept, with where it repeats.
 * Mirrored as `top_compositions` in `backend/ttnn_visualizer/agent/l1_peak.py`.
 */
export function getTopL1PeakOperations<T extends L1PeakDecomposition>(
    entries: Iterable<T>,
    count: number,
): L1PeakTopOperation<T>[] {
    const byComposition = new Map<string, L1PeakTopOperation<T>>();

    [...entries]
        .sort(
            (left, right) =>
                compareTotalsDescending(left.totalBytes, right.totalBytes) || left.operationId - right.operationId,
        )
        .forEach((entry) => {
            // Joined, so every NaN is one key and -0 is 0.
            const key = [
                entry.totalBytes,
                entry.circularBufferBytes,
                entry.intermediateTensorBytes,
                entry.persistentTensorBytes,
                entry.staleTensorBytes,
            ].join(':');
            const seen = byComposition.get(key);

            if (seen) {
                seen.alsoAt.push(entry.operationId);
            } else {
                byComposition.set(key, { entry, alsoAt: [] });
            }
        });

    return [...byComposition.values()].slice(0, count);
}
