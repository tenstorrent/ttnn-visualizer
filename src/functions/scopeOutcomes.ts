// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { ScopeOutcome } from '../definitions/ScopeOutcome';
import { Node, NodeType } from '../model/APIData';
import { isDeviceOperation } from './filterOperations';
import { getAbortReason, getScopePairing } from './linkableDeviceOperations';

/** One scope closing, and how it ended. */
export interface ScopeClose {
    startIndex: number;
    outcome: ScopeOutcome;
    /** The end that closed it; `null` when it was left open and something else closed it. */
    endIndex: number | null;
    abortReason: string | null;
}

export interface ScopeOutcomes {
    /** The scopes that close at each node, innermost first, before that node is handled. */
    closesByIndex: Map<number, ScopeClose[]>;
    /** The scopes still open when the graph ends, innermost first. */
    closesAtEnd: ScopeClose[];
    outcomeByStartIndex: Map<number, ScopeOutcome>;
}

interface OpenScope {
    startIndex: number;
    stackingLevel: number | undefined;
}

/**
 * How every function scope in one captured graph ended, and where it closed, so that
 * anything nesting the graph closes the same scopes in the same order.
 *
 * Builds on `getScopePairing`, adding the rules for scopes no end closes:
 * - An end closes every scope opened inside its own and still open.
 * - A start no deeper than the innermost open scope, by `stacking_level`, closes that
 *   scope: it is a sibling older tt-metal left open when it failed. Captures without
 *   `stacking_level` nest the new scope inside instead.
 * - A scope left open is failed when the operation recorded an error. Otherwise the
 *   capture was only cut off.
 *
 * An end whose scope is not open, such as one left over from an earlier operation's
 * unwind, closes nothing.
 *
 * Unlike the perf linking, an end that a crossed pairing already closed counts for
 * nothing here, so the two can disagree on a graph whose ends cross. tt-metal names
 * each end after the innermost open scope, so that shape is not expected.
 */
export const getScopeOutcomes = (nodes: Node[], hasRecordedError: boolean): ScopeOutcomes => {
    const pairing = getScopePairing(nodes);
    const unclosedOutcome = hasRecordedError ? ScopeOutcome.FAILED : ScopeOutcome.UNCLOSED;
    const open: OpenScope[] = [];
    const closesByIndex = new Map<number, ScopeClose[]>();
    const outcomeByStartIndex = new Map<number, ScopeOutcome>();

    const close = (
        closes: ScopeClose[],
        outcome: ScopeOutcome,
        endIndex: number | null = null,
        abortReason: string | null = null,
    ) => {
        const { startIndex } = open.pop()!;

        closes.push({ startIndex, outcome, endIndex, abortReason });
        outcomeByStartIndex.set(startIndex, outcome);
    };

    nodes.forEach((node, index) => {
        const closes: ScopeClose[] = [];

        if (node.node_type === NodeType.function_start) {
            const stackingLevel = node.stacking_level;

            while (
                stackingLevel !== undefined &&
                open.length > 0 &&
                open[open.length - 1].stackingLevel !== undefined &&
                open[open.length - 1].stackingLevel! >= stackingLevel
            ) {
                close(closes, unclosedOutcome);
            }

            open.push({ startIndex: index, stackingLevel });
        } else if (node.node_type === NodeType.function_end) {
            const startIndex = pairing.startIndexByEndIndex.get(index);

            if (startIndex !== undefined && open.some((scope) => scope.startIndex === startIndex)) {
                while (open[open.length - 1].startIndex !== startIndex) {
                    close(closes, unclosedOutcome);
                }

                close(
                    closes,
                    pairing.abortedEndIndices.has(index) ? ScopeOutcome.FAILED : ScopeOutcome.COMPLETED,
                    index,
                    getAbortReason(node),
                );
            }
        }

        if (closes.length > 0) {
            closesByIndex.set(index, closes);
        }
    });

    const closesAtEnd: ScopeClose[] = [];

    while (open.length > 0) {
        close(closesAtEnd, unclosedOutcome);
    }

    return { closesByIndex, closesAtEnd, outcomeByStartIndex };
};

/**
 * The device operations in one operation's captured graph whose launch did not complete.
 * Read only for an operation with a recorded error, so a scope left open counts as failed,
 * as the device operations tree marks it.
 */
export const getFailedDeviceOperationNames = (nodes: Node[] | null | undefined): string[] => {
    if (!Array.isArray(nodes)) {
        return [];
    }

    const { outcomeByStartIndex } = getScopeOutcomes(nodes, true);
    const names: string[] = [];

    // In captured order, not closing order, which runs innermost first.
    nodes.forEach((node, index) => {
        // Graph params come straight from the capture, so `params` is guarded despite its type.
        const name = node.node_type === NodeType.function_start ? node.params?.name : undefined;

        if (name !== undefined && isDeviceOperation(name) && outcomeByStartIndex.get(index) === ScopeOutcome.FAILED) {
            names.push(name);
        }
    });

    return names;
};
