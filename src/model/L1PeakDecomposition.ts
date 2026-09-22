// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { L1PeakPrecision, L1PeakStatus, L1ResidentKind } from '../definitions/L1PeakDecomposition';
import { Buffer, Node } from './APIData';

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
     * Post-op L1 residents per operation id. Ground truth for what survives an operation:
     * the captured graph emits fewer `buffer_deallocate` nodes than `buffer_allocate` ones
     * (517 vs 255 on resnet50), so a graph-only replay accumulates allocations that were in
     * fact freed. #2025
     */
    snapshotByOperationId: ReadonlyMap<number, readonly Buffer[]>;
    /**
     * Last operation that genuinely used the tensor at an address, excluding deallocate
     * calls. Build it from `getLastValidConsumer` so staleness means the same thing here as
     * it does behind Buffer Summary's hatching.
     *
     * Addresses are recycled — resnet50 reuses 1,413,632 across 40 tensors — so an address
     * with more than one lifetime has no single answer and belongs omitted rather than
     * collapsed. Staleness is then a floor. #2029
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
    byOperationId: ReadonlyMap<number, L1PeakDecomposition>;
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
     * ever made and reports 324,188,384 B — 216x a bank. Rather than guess at a repair, say
     * the number is unusable. This catches only captures that overshoot: `traces_51674_report`
     * is degenerate differently — all eight buffer rows sit at address 0 — and stays under
     * the budget, so it is reported normally.
     */
    exceedsCapacity: boolean;
}

export interface L1PeakDecompositionState {
    status: L1PeakStatus;
    data: L1PeakDecompositionResult | null;
    /**
     * Addresses hosting more than one tensor lifetime, where staleness cannot be attributed
     * to the tensor actually resident. Those are left unclassified, so the stale figure is a
     * floor and the UI has to say so. #2029
     */
    unattributableStaleAddressCount: number;
}
