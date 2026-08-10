// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DEALLOCATE_OP_NAME_LIST } from '../definitions/Deallocate';
import { LATE_DEALLOC_OPPORTUNITY_TEXT, LateDeallocationRunStart } from '../definitions/LateDeallocation';
import { TensorDeallocationReport } from '../model/BufferSummary';

/** Sentinel for "this tensor has no consumer we can attribute a last use to". */
export const NO_CONSUMER_OPERATION_ID = -1;

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
    // Numeric comparator is load-bearing: the default `sort()` compares
    // stringified values, so op 2 outranks op 10 and the "last" consumer comes
    // back too early, flagging every row in between as late-deallocated.
    const remaining = [...consumers].sort((a, b) => a - b);

    while (remaining.length > 0) {
        const lastConsumerOperationId = remaining.pop() ?? NO_CONSUMER_OPERATION_ID;
        const lastConsumerName = operationNamesById.get(lastConsumerOperationId) ?? '';

        if (
            lastConsumerOperationId > NO_CONSUMER_OPERATION_ID &&
            !DEALLOCATE_OP_NAME_LIST.includes(lastConsumerName.toLowerCase())
        ) {
            return { lastConsumerOperationId, lastConsumerName };
        }
    }

    return { lastConsumerOperationId: NO_CONSUMER_OPERATION_ID, lastConsumerName: '' };
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

/** Tooltip and accessible name for a rail dot. */
export const getLateDeallocationRunStartSummary = (runStart: LateDeallocationRunStart): string => {
    const tensorIds = runStart.tensors.map((tensor) => tensor.id).join(', ');
    const noun = runStart.tensors.length === 1 ? 'tensor' : 'tensors';
    const [firstTensor] = runStart.tensors;
    // Every tensor starting a run here shares this row as its last use, so the
    // consumer only needs naming once.
    const lastUse = firstTensor.consumerName
        ? ` — last used by ${firstTensor.lastConsumerOperationId} ${firstTensor.consumerName}`
        : '';

    return `${LATE_DEALLOC_OPPORTUNITY_TEXT}: ${noun} ${tensorIds}${lastUse}`;
};

/** Tooltip for the count shown beside the Buffer Summary toggle. */
export const getLateDeallocationCountSummary = (runStartCount: number): string =>
    `${runStartCount} ${runStartCount === 1 ? 'operation holds' : 'operations hold'} a tensor that is no longer used`;
