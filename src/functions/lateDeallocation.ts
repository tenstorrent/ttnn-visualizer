// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DEALLOCATE_OP_NAME_LIST } from '../definitions/Deallocate';
import { LATE_DEALLOC_OPPORTUNITY_TEXT, LateDeallocationRunStart } from '../definitions/LateDeallocation';
import { TensorDeallocationReport, TensorsByOperationByAddress } from '../model/BufferSummary';

/** Sentinel for "this tensor has no consumer we can attribute a last use to". */
export const NO_CONSUMER_OPERATION_ID = -1;

const DEALLOCATE_OP_NAMES = new Set(DEALLOCATE_OP_NAME_LIST);

export interface LastValidConsumer {
    lastConsumerOperationId: number;
    lastConsumerName: string;
}

/**
 * Resolve a tensor's last *meaningful* consumer: the highest consumer op id
 * that isn't itself a deallocate call, since a deallocate consuming the tensor
 * is the very thing we're measuring the distance to.
 */
export const getLastValidConsumer = (
    consumers: readonly number[],
    operationNamesById: Map<number, string>,
): LastValidConsumer => {
    // Tracking the highest id in one pass, rather than sorting a copy: this
    // runs once per (operation, tensor) pair across the whole report. Comparing
    // ids numerically is load-bearing — the default `sort()` compared
    // stringified values, so op 2 outranked op 10 and the "last" consumer came
    // back too early, flagging every row in between as late-deallocated.
    let lastConsumerOperationId = NO_CONSUMER_OPERATION_ID;
    let lastConsumerName = '';

    consumers.forEach((consumerOperationId) => {
        if (consumerOperationId <= lastConsumerOperationId) {
            return;
        }

        const consumerName = operationNamesById.get(consumerOperationId) ?? '';

        if (DEALLOCATE_OP_NAMES.has(consumerName.toLowerCase())) {
            return;
        }

        lastConsumerOperationId = consumerOperationId;
        lastConsumerName = consumerName;
    });

    return { lastConsumerOperationId, lastConsumerName };
};

export interface LateDeallocationCandidate {
    /** Tensor id as the report gives it; a missing id can't be reported on. */
    tensorId: number | null;
    address: number;
    /** The operation still holding the buffer at this address. */
    operationId: number;
    consumers: readonly number[] | null;
}

/**
 * Whether a tensor is still allocated at `operationId` past its last real use,
 * and the report the overlay draws when it is.
 *
 * `lastConsumerByTensorId` memoises consumer resolution: a tensor alive across
 * N operations is asked N times, and its consumers can't differ between them.
 * The caller owns the cache so it lives no longer than one derivation pass.
 */
export const getLateDeallocationReport = (
    { tensorId, address, operationId, consumers }: LateDeallocationCandidate,
    operationNamesById: Map<number, string>,
    lastConsumerByTensorId?: Map<number, LastValidConsumer>,
): TensorDeallocationReport | null => {
    if (!tensorId || !consumers || consumers.length === 0) {
        return null;
    }

    let lastValidConsumer = lastConsumerByTensorId?.get(tensorId);

    if (!lastValidConsumer) {
        lastValidConsumer = getLastValidConsumer(consumers, operationNamesById);
        lastConsumerByTensorId?.set(tensorId, lastValidConsumer);
    }

    const { lastConsumerOperationId, lastConsumerName } = lastValidConsumer;

    // A tensor whose only consumers are deallocate calls has no last *use* to
    // be late relative to. Without the sentinel guard it flagged as
    // late-deallocated and reported its last consumer as `-1`.
    if (lastConsumerOperationId <= NO_CONSUMER_OPERATION_ID || lastConsumerOperationId >= operationId) {
        return null;
    }

    return {
        id: tensorId,
        address,
        consumerName: lastConsumerName,
        lastConsumerOperationId,
        lastOperationId: operationId,
    };
};

export interface BuildLateDeallocationReportsParams {
    /** Tensors alive at each operation, keyed by operation id then buffer address. */
    tensorsByOperation: TensorsByOperationByAddress;
    operationNamesById: Map<number, string>;
}

export interface LateDeallocationReports {
    /** Per operation: the rows to hatch, and the tensors their gutter badge names. */
    reportsByOpId: Map<number, TensorDeallocationReport[]>;
    /**
     * One entry per tensor, the last operation to report it winning — so the
     * report describes the tensor's final holder as long as the caller's map is
     * in operation order. Feeds the Tensor List's late-deallocated filter and
     * count.
     */
    reportsByTensorId: Map<number, TensorDeallocationReport>;
}

/**
 * Collect the late-deallocation reports for a whole profiler report, indexed the
 * two ways the app consumes them.
 *
 * One pass fills both indexes: they answer different questions about the same
 * finding — which rows to mark, and which tensors to offer in the Tensor List —
 * and deriving either from the other afterwards would walk the report again.
 */
export const buildLateDeallocationReports = ({
    tensorsByOperation,
    operationNamesById,
}: BuildLateDeallocationReportsParams): LateDeallocationReports => {
    const reportsByOpId = new Map<number, TensorDeallocationReport[]>();
    const reportsByTensorId = new Map<number, TensorDeallocationReport>();
    // Lives for this pass only: a tensor alive across many operations is asked
    // about once per operation, and resolving its last consumer costs the same
    // every time.
    const lastConsumerByTensorId = new Map<number, LastValidConsumer>();

    tensorsByOperation.forEach((tensorsByAddress, operationId) => {
        tensorsByAddress.forEach((tensor, address) => {
            const report = getLateDeallocationReport(
                { tensorId: tensor.id, address, operationId, consumers: tensor.consumers },
                operationNamesById,
                lastConsumerByTensorId,
            );

            if (!report) {
                return;
            }

            const reportsForOperation = reportsByOpId.get(operationId);

            if (reportsForOperation) {
                reportsForOperation.push(report);
            } else {
                reportsByOpId.set(operationId, [report]);
            }

            reportsByTensorId.set(report.id, report);
        });
    });

    return { reportsByOpId, reportsByTensorId };
};

export interface SelectLateDeallocationRunStartsParams {
    /** Rows as rendered, in display order. */
    operations: readonly { id: number }[];
    reportsByOpId: Map<number, TensorDeallocationReport[]>;
}

/**
 * A tensor occupies the same address for the whole of its stale run, but an
 * address outlives the tensor that used it — so runs are tracked per tensor
 * *and* address. Keying on either alone would merge two tensors that reuse one
 * address into a single run, losing the second one's start.
 */
const getRunKey = (report: TensorDeallocationReport): string => `${report.id}:${report.address}`;

/**
 * Find the rows where a tensor *becomes* stale, in rendered order.
 *
 * A late-deallocated tensor is reported on every row from its last consumer
 * until it is actually freed, so treating each reported row as a finding would
 * inflate one missing deallocate into dozens. Run starts answer the question
 * the user has: which places are worth looking at. A run opens whenever the
 * previous row didn't report the same tensor, so a tensor that drops out and
 * comes back is two findings rather than one continuous span.
 */
export const selectLateDeallocationRunStarts = ({
    operations,
    reportsByOpId,
}: SelectLateDeallocationRunStartsParams): LateDeallocationRunStart[] => {
    if (operations.length === 0 || reportsByOpId.size === 0) {
        return [];
    }

    const runStarts: LateDeallocationRunStart[] = [];
    let previousRunKeys = new Set<string>();

    operations.forEach((operation, rowIndex) => {
        const reports = reportsByOpId.get(operation.id);

        if (!reports || reports.length === 0) {
            previousRunKeys = new Set<string>();
            return;
        }

        const runKeys = new Set<string>();
        const tensors: TensorDeallocationReport[] = [];

        reports.forEach((report) => {
            const runKey = getRunKey(report);
            runKeys.add(runKey);

            if (!previousRunKeys.has(runKey)) {
                tensors.push(report);
            }
        });

        if (tensors.length > 0) {
            runStarts.push({ opId: operation.id, rowIndex, tensors });
        }

        previousRunKeys = runKeys;
    });

    return runStarts;
};

/** How many tensors a marker names before it just counts the rest. */
export const MAX_NAMED_TENSORS = 5;

/**
 * Name at most `MAX_NAMED_TENSORS` of them and count the remainder.
 *
 * A coalesced rail dot stands for every run start in its bucket, so an uncapped
 * list grows with the report: unreadable as a tooltip, and retained as long as
 * the rail is mounted because it doubles as the dot's accessible name.
 */
const getTensorNameList = (names: readonly string[]): string => {
    if (names.length <= MAX_NAMED_TENSORS) {
        return names.join(', ');
    }

    return `${names.slice(0, MAX_NAMED_TENSORS).join(', ')} and ${names.length - MAX_NAMED_TENSORS} more`;
};

/** Tooltip and accessible name for the tensors a marker stands for. */
export const getLateDeallocationSummary = (tensors: readonly TensorDeallocationReport[]): string => {
    if (tensors.length === 0) {
        return LATE_DEALLOC_OPPORTUNITY_TEXT;
    }

    const noun = tensors.length === 1 ? 'tensor' : 'tensors';
    const [firstTensor] = tensors;
    const hasSharedLastUse = tensors.every(
        (tensor) => tensor.lastConsumerOperationId === firstTensor.lastConsumerOperationId,
    );

    if (hasSharedLastUse) {
        const lastUse = firstTensor.consumerName
            ? ` — last used by ${firstTensor.lastConsumerOperationId} ${firstTensor.consumerName}`
            : '';
        const tensorIds = getTensorNameList(tensors.map((tensor) => `${tensor.id}`));

        return `${LATE_DEALLOC_OPPORTUNITY_TEXT}: ${noun} ${tensorIds}${lastUse}`;
    }

    // Rows are the unique-buffer slice and a run can re-open after a gap, so
    // tensors reported together needn't share a last use — naming one of them
    // for all would attribute the wrong operation to the rest.
    const namedTensors = getTensorNameList(
        tensors.map((tensor) =>
            tensor.consumerName
                ? `${tensor.id} (last used by ${tensor.lastConsumerOperationId} ${tensor.consumerName})`
                : `${tensor.id}`,
        ),
    );

    return `${LATE_DEALLOC_OPPORTUNITY_TEXT}: ${noun} ${namedTensors}`;
};

/**
 * Tooltip for the count shown beside the Buffer Summary toggle.
 *
 * Worded around a tensor *becoming* stale because that is what the count
 * counts: one report can hatch dozens of rows off a single missing deallocate,
 * so copy about operations "holding" a tensor would contradict the overlay it
 * sits beside.
 */
export const getLateDeallocationCountSummary = (runStartCount: number): string =>
    `${runStartCount} ${
        runStartCount === 1 ? 'operation' : 'operations'
    } where a tensor starts being held past its last use`;

export interface CoalesceLateDeallocationRunStartsParams {
    runStarts: readonly LateDeallocationRunStart[];
    /** Rows the rail spans; dots are placed by `rowIndex / rowCount`. */
    rowCount: number;
    maxDots: number;
}

/**
 * Merge run starts that would land on the same sliver of the rail.
 *
 * Run starts are bounded only by the report, so a large one asks for thousands
 * of dots in a gutter a few hundred pixels tall: they cover each other, and the
 * ones underneath can't be clicked at all. A merged dot carries every tensor it
 * swallowed, so no finding the count advertises is dropped on the way to a
 * tooltip, and it lands on the first row of its group so a click still goes
 * somewhere useful.
 *
 * Reports small enough to draw honestly get one bucket per row and are
 * returned untouched.
 */
export const coalesceLateDeallocationRunStarts = ({
    runStarts,
    rowCount,
    maxDots,
}: CoalesceLateDeallocationRunStartsParams): LateDeallocationRunStart[] => {
    if (rowCount === 0) {
        return [];
    }

    const bucketCount = Math.min(maxDots, rowCount);
    const runStartsByBucket = new Map<number, LateDeallocationRunStart>();

    runStarts.forEach((runStart) => {
        const bucket = Math.floor((runStart.rowIndex / rowCount) * bucketCount);
        const merged = runStartsByBucket.get(bucket);

        if (merged) {
            merged.tensors.push(...runStart.tensors);
        } else {
            // Copy the tensor list: the run starts are memoised across renders,
            // so pushing into their arrays would append the same tensors again
            // on every re-render.
            runStartsByBucket.set(bucket, { ...runStart, tensors: [...runStart.tensors] });
        }
    });

    return [...runStartsByBucket.values()];
};
