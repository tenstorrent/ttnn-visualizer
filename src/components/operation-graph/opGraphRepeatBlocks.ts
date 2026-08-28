// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/* eslint-disable no-continue -- window scan skips consumed spans instead of nesting four levels */

import type { OpGraphSourceOperation, RepeatBlockInstance } from './opGraphTypes';

export const MIN_REPEAT_WINDOW = 2;
export const MIN_REPEAT_COUNT = 2;
// A repeated subgraph is a layer, not half the graph. Descending from ⌊N/2⌋
// made the no-repeat case — the common one — O(N³) and folded 12 layers into
// two half-model blocks. #1583
export const MAX_REPEAT_WINDOW = 64;
// 4k–8k op graphs are real (#1809). Past this the scan is skipped rather than
// competing with Dagre; the main-thread fallback calls the same detector.
export const MAX_DETECT_OPS = 10_000;
// Consumer not in the kept list still counts as a leaving edge so hide-deallocate
// cannot erase the first copy's outgoing tensor and miss the run.
const OUTSIDE_KEPT = -1;
// Weight-dump helpers share one file and drown the modules that identify the
// layer. Keep them only when every member is plumbing.
const PLUMBING_FILE_STEMS = new Set(['lazy_weight']);
const MAX_PATTERN_NAME_PARTS = 4;
// A file on most of the graph is the model (ttnn_functional_resnet50), not the
// tile. Drop it and name from ops. Module files stay under this.
const GLOBAL_FILE_FRACTION = 0.75;

interface OutgoingEdge {
    targetIndex: number;
    label: string;
}

const fingerprintOf = (operation: OpGraphSourceOperation): string => {
    const inputs = (operation.inputShapes ?? []).join(',');
    const outputs = operation.outputs.map((output) => output.edgeLabel).join(',');
    return `${operation.name}|${inputs}|${outputs}`;
};

const internFingerprints = (fingerprints: readonly string[]): number[] => {
    const idByFingerprint = new Map<string, number>();
    const ids: number[] = [];
    for (const fingerprint of fingerprints) {
        let id = idByFingerprint.get(fingerprint);
        if (id === undefined) {
            id = idByFingerprint.size + 1;
            idByFingerprint.set(fingerprint, id);
        }
        ids.push(id);
    }
    return ids;
};

const idsEqual = (ids: readonly number[], left: number, right: number, length: number): boolean => {
    for (let offset = 0; offset < length; offset++) {
        if (ids[left + offset] !== ids[right + offset]) {
            return false;
        }
    }
    return true;
};

// Internal edges as `i->j:label`; edges that leave the window as `i->out:label`.
// The out-edges are what keep a terminal copy from joining when its last op no
// longer feeds the next copy — fingerprint equality only sees output labels.
const windowStructure = (start: number, length: number, outgoing: readonly (readonly OutgoingEdge[])[]): string => {
    const end = start + length;
    const parts: string[] = [];
    for (let offset = 0; offset < length; offset++) {
        for (const edge of outgoing[start + offset]) {
            if (edge.targetIndex >= start && edge.targetIndex < end) {
                parts.push(`${offset}->${edge.targetIndex - start}:${edge.label}`);
            } else {
                parts.push(`${offset}->out:${edge.label}`);
            }
        }
    }
    return parts.sort().join('|');
};

const blockLetter = (index: number): string => {
    let remaining = index + 1;
    let label = '';
    while (remaining > 0) {
        remaining -= 1;
        label = String.fromCharCode(65 + (remaining % 26)) + label;
        remaining = Math.floor(remaining / 26);
    }
    return label;
};

const fileStemOf = (fileIdentifier: string): string => {
    if (!fileIdentifier) {
        return '';
    }
    const withoutLine = fileIdentifier.replace(/:\d+$/, '');
    const base = withoutLine.split('/').pop() ?? withoutLine;
    return base.replace(/\.py$/i, '');
};

const uniqueFileStems = (operations: readonly OpGraphSourceOperation[], dropPlumbing: boolean): string[] => {
    const stems: string[] = [];
    const seen = new Set<string>();
    for (const operation of operations) {
        const stem = fileStemOf(operation.fileIdentifier);
        if (!stem || seen.has(stem) || (dropPlumbing && PLUMBING_FILE_STEMS.has(stem))) {
            continue;
        }
        seen.add(stem);
        stems.push(stem);
    }
    return stems;
};

const shortOperationName = (name: string): string => {
    const trimmed = name.trim();
    if (!trimmed) {
        return '';
    }
    const parts = trimmed.split(/::|\./);
    return parts[parts.length - 1] || trimmed;
};

const uniqueShortOpNames = (operations: readonly OpGraphSourceOperation[]): string[] => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (const operation of operations) {
        const short = shortOperationName(operation.name);
        if (!short || seen.has(short)) {
            continue;
        }
        seen.add(short);
        names.push(short);
    }
    return names;
};

// Module files from one model share a framework-and-model prefix: the four
// SentenceBERT files behind one block named it in 124 characters, 72 of which were
// `ttnn_sentencebert_` four times over, so the node showed three of the four parts
// and clipped the rest. A prefix every part carries is context, not distinction.
// #1944
const MIN_DISTINGUISHING_STEM_LENGTH = 3;

// `> index + 1` leaves every stem at least one segment of its own, so a set where
// one stem is a prefix of the others keeps that stem whole.
const isSegmentShared = (segmented: readonly string[][], index: number): boolean =>
    segmented.every((segments) => segments.length > index + 1 && segments[index] === segmented[0][index]);

const dropSharedStemPrefix = (stems: readonly string[]): string[] => {
    if (stems.length < 2) {
        return [...stems];
    }
    const segmented = stems.map((stem) => stem.split('_'));
    let shared = 0;
    while (isSegmentShared(segmented, shared)) {
        shared += 1;
    }
    if (shared === 0) {
        return [...stems];
    }
    const trimmed = segmented.map((segments) => segments.slice(shared).join('_'));
    // A remainder of a letter or two names nothing on its own — `mlp_up + mlp_down`
    // is worth its length in a way `up + down` is not — so keep the prefix rather
    // than reduce the label to initials.
    if (trimmed.some((stem) => stem.length < MIN_DISTINGUISHING_STEM_LENGTH)) {
        return [...stems];
    }
    return trimmed;
};

const joinCapped = (parts: readonly string[]): string => {
    if (parts.length <= MAX_PATTERN_NAME_PARTS) {
        return parts.join(' + ');
    }
    return `${parts.slice(0, MAX_PATTERN_NAME_PARTS).join(' + ')} + …`;
};

const globalFileStems = (operations: readonly OpGraphSourceOperation[]): Set<string> => {
    const counts = new Map<string, number>();
    for (const operation of operations) {
        const stem = fileStemOf(operation.fileIdentifier);
        if (!stem || PLUMBING_FILE_STEMS.has(stem)) {
            continue;
        }
        counts.set(stem, (counts.get(stem) ?? 0) + 1);
    }
    const threshold = operations.length * GLOBAL_FILE_FRACTION;
    const stems = new Set<string>();
    for (const [stem, count] of counts) {
        if (count > threshold) {
            stems.add(stem);
        }
    }
    return stems;
};

export function formatRepeatPatternLabel(
    members: readonly OpGraphSourceOperation[],
    graphOperations: readonly OpGraphSourceOperation[] = members,
): string {
    const opNames = uniqueShortOpNames(members);
    // One operation type is named by that operation, not by the file it came from.
    // A module stem earns the label when it *summarises* several distinct
    // operations — `norm + attention + encoder + mlp` beats listing eight op
    // names. When there is only one, the stem says where the operation lives
    // while the name says what it is, and the name is what the node is for.
    if (opNames.length === 1) {
        return opNames[0];
    }
    const globalStems = globalFileStems(graphOperations);
    const moduleStems = uniqueFileStems(members, true).filter((stem) => !globalStems.has(stem));
    if (moduleStems.length > 0) {
        return joinCapped(dropSharedStemPrefix(moduleStems));
    }
    if (opNames.length > 0) {
        return joinCapped(opNames);
    }
    return joinCapped(dropSharedStemPrefix(uniqueFileStems(members, false)));
}

const labelForPattern = (
    patternId: string,
    members: readonly OpGraphSourceOperation[],
    graphOperations: readonly OpGraphSourceOperation[],
    labelByPatternId: Map<string, string>,
    collisionCountBySummary: Map<string, number>,
    anonymousCount: { value: number },
): string => {
    const existing = labelByPatternId.get(patternId);
    if (existing !== undefined) {
        return existing;
    }

    const summary = formatRepeatPatternLabel(members, graphOperations);
    if (!summary) {
        const label = `Block ${blockLetter(anonymousCount.value)}`;
        anonymousCount.value += 1;
        labelByPatternId.set(patternId, label);
        return label;
    }

    const prior = collisionCountBySummary.get(summary) ?? 0;
    collisionCountBySummary.set(summary, prior + 1);
    const label = prior === 0 ? summary : `${summary} · ${blockLetter(prior)}`;
    labelByPatternId.set(patternId, label);
    return label;
};

const isRangeConsumed = (consumed: Uint8Array, start: number, length: number): boolean => {
    for (let offset = 0; offset < length; offset++) {
        if (consumed[start + offset]) {
            return true;
        }
    }
    return false;
};

const markConsumed = (consumed: Uint8Array, start: number, length: number): void => {
    consumed.fill(1, start, start + length);
};

/**
 * Smallest window that repeats, extended as far as it matches. A 1-op run is
 * the common "same name twice" case and is too noisy to collapse.
 */
export function detectRepeatBlocks(keptOperations: readonly OpGraphSourceOperation[]): RepeatBlockInstance[] {
    const count = keptOperations.length;
    if (count < MIN_REPEAT_WINDOW * MIN_REPEAT_COUNT || count > MAX_DETECT_OPS) {
        return [];
    }

    const fingerprints = keptOperations.map(fingerprintOf);
    const ids = internFingerprints(fingerprints);
    const operationIds = keptOperations.map((operation) => operation.id);
    const indexById = new Map<number, number>(operationIds.map((id, index) => [id, index]));
    const outgoing: OutgoingEdge[][] = operationIds.map(() => []);
    for (let sourceIndex = 0; sourceIndex < count; sourceIndex++) {
        for (const output of keptOperations[sourceIndex].outputs) {
            for (const consumer of output.consumers) {
                const targetIndex = indexById.get(consumer) ?? OUTSIDE_KEPT;
                outgoing[sourceIndex].push({ targetIndex, label: output.edgeLabel });
            }
        }
    }

    const consumed = new Uint8Array(count);
    const runs: { start: number; length: number; repeatCount: number }[] = [];
    const maxLength = Math.min(MAX_REPEAT_WINDOW, Math.floor(count / MIN_REPEAT_COUNT));

    for (let length = MIN_REPEAT_WINDOW; length <= maxLength; length++) {
        let start = 0;
        while (start <= count - length * MIN_REPEAT_COUNT) {
            const nextStart = start + length;
            // O(1) and necessary for the window to repeat at all, so it goes ahead
            // of the two O(length) consumed walks rather than behind them. The
            // while condition keeps `nextStart` in bounds. Same control flow —
            // every rejected `start` still advances by one.
            if (consumed[start] || ids[start] !== ids[nextStart]) {
                start += 1;
                continue;
            }

            if (
                isRangeConsumed(consumed, start, length) ||
                isRangeConsumed(consumed, nextStart, length) ||
                !idsEqual(ids, start, nextStart, length)
            ) {
                start += 1;
                continue;
            }

            const structure = windowStructure(start, length, outgoing);
            if (windowStructure(nextStart, length, outgoing) !== structure) {
                start += 1;
                continue;
            }

            let repeatCount = 2;
            while (start + (repeatCount + 1) * length <= count) {
                const following = start + repeatCount * length;
                if (isRangeConsumed(consumed, following, length)) {
                    break;
                }
                if (!idsEqual(ids, start, following, length)) {
                    break;
                }
                if (windowStructure(following, length, outgoing) !== structure) {
                    break;
                }
                repeatCount += 1;
            }

            const span = repeatCount * length;
            runs.push({ start, length, repeatCount });
            markConsumed(consumed, start, span);
            start += span;
        }
    }

    runs.sort((left, right) => left.start - right.start);

    const labelByPatternId = new Map<string, string>();
    const collisionCountBySummary = new Map<string, number>();
    const anonymousCount = { value: 0 };
    const instances: RepeatBlockInstance[] = [];
    runs.forEach((run, runIndex) => {
        const patternId = `${ids.slice(run.start, run.start + run.length).join(',')}#${windowStructure(run.start, run.length, outgoing)}`;
        const members = keptOperations.slice(run.start, run.start + run.length);
        const patternLabel = labelForPattern(
            patternId,
            members,
            keptOperations,
            labelByPatternId,
            collisionCountBySummary,
            anonymousCount,
        );
        for (let instanceIndex = 0; instanceIndex < run.repeatCount; instanceIndex++) {
            const instanceStart = run.start + instanceIndex * run.length;
            const memberIds = operationIds.slice(instanceStart, instanceStart + run.length);
            instances.push({
                instanceId: `block:${runIndex}:${memberIds[0]}`,
                patternId,
                label: `${patternLabel} × ${run.repeatCount}`,
                patternLabel,
                operationIds: memberIds,
                instanceIndex,
                instanceCount: run.repeatCount,
            });
        }
    });

    return instances;
}
