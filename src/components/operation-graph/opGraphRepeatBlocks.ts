// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

/* eslint-disable no-continue -- window scan skips consumed spans instead of nesting four levels */

import type { OpGraphSourceOperation } from './opGraphTypes';

export const MIN_REPEAT_WINDOW = 2;
export const MIN_REPEAT_COUNT = 2;

export interface RepeatBlockInstance {
    instanceId: string;
    patternId: string;
    label: string;
    patternLabel: string;
    operationIds: number[];
    instanceIndex: number;
    instanceCount: number;
}

interface InternalEdge {
    target: number;
    label: string;
}

const fingerprintOf = (operation: OpGraphSourceOperation): string => {
    const inputs = (operation.inputShapes ?? []).join(',');
    const outputs = operation.outputs.map((output) => output.edgeLabel).join(',');
    return `${operation.name}|${inputs}|${outputs}`;
};

const windowKey = (fingerprints: string[], start: number, length: number): string =>
    fingerprints.slice(start, start + length).join(';');

const internalEdgeSignature = (
    operationIds: number[],
    edgesBySource: ReadonlyMap<number, readonly InternalEdge[]>,
): string => {
    const indexById = new Map<number, number>(operationIds.map((id, index) => [id, index]));
    const parts: string[] = [];
    for (let index = 0; index < operationIds.length; index++) {
        for (const edge of edgesBySource.get(operationIds[index]) ?? []) {
            const targetIndex = indexById.get(edge.target);
            if (targetIndex !== undefined) {
                parts.push(`${index}->${targetIndex}:${edge.label}`);
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
 * Longest contiguous, structurally equal windows first. A 1-op run is the
 * common "same name twice" case and is too noisy to collapse.
 */
export function detectRepeatBlocks(keptOperations: readonly OpGraphSourceOperation[]): RepeatBlockInstance[] {
    const count = keptOperations.length;
    if (count < MIN_REPEAT_WINDOW * MIN_REPEAT_COUNT) {
        return [];
    }

    const fingerprints = keptOperations.map(fingerprintOf);
    const operationIds = keptOperations.map((operation) => operation.id);
    const keptIds = new Set<number>(operationIds);
    const edgesBySource = new Map<number, InternalEdge[]>();
    for (const operation of keptOperations) {
        const outgoing: InternalEdge[] = [];
        for (const output of operation.outputs) {
            for (const consumer of output.consumers) {
                if (keptIds.has(consumer)) {
                    outgoing.push({ target: consumer, label: output.edgeLabel });
                }
            }
        }
        edgesBySource.set(operation.id, outgoing);
    }

    const consumed = new Uint8Array(count);
    const runs: { start: number; length: number; repeatCount: number }[] = [];

    for (let length = Math.floor(count / MIN_REPEAT_COUNT); length >= MIN_REPEAT_WINDOW; length--) {
        let start = 0;
        while (start <= count - length * MIN_REPEAT_COUNT) {
            if (consumed[start] || isRangeConsumed(consumed, start, length)) {
                start += 1;
                continue;
            }

            const key = windowKey(fingerprints, start, length);
            const structure = internalEdgeSignature(operationIds.slice(start, start + length), edgesBySource);
            let repeatCount = 1;
            while (start + (repeatCount + 1) * length <= count) {
                const nextStart = start + repeatCount * length;
                if (isRangeConsumed(consumed, nextStart, length)) {
                    break;
                }
                if (windowKey(fingerprints, nextStart, length) !== key) {
                    break;
                }
                const nextIds = operationIds.slice(nextStart, nextStart + length);
                if (internalEdgeSignature(nextIds, edgesBySource) !== structure) {
                    break;
                }
                repeatCount += 1;
            }

            if (repeatCount >= MIN_REPEAT_COUNT) {
                const span = repeatCount * length;
                runs.push({ start, length, repeatCount });
                markConsumed(consumed, start, span);
                start += span;
                continue;
            }

            start += 1;
        }
    }

    runs.sort((left, right) => left.start - right.start);

    const instances: RepeatBlockInstance[] = [];
    runs.forEach((run, patternIndex) => {
        const patternLabel = `Block ${blockLetter(patternIndex)}`;
        const firstIds = operationIds.slice(run.start, run.start + run.length);
        const patternId = `${windowKey(fingerprints, run.start, run.length)}#${internalEdgeSignature(firstIds, edgesBySource)}`;
        for (let instanceIndex = 0; instanceIndex < run.repeatCount; instanceIndex++) {
            const instanceStart = run.start + instanceIndex * run.length;
            const ids = operationIds.slice(instanceStart, instanceStart + run.length);
            instances.push({
                instanceId: `block:${patternIndex}:${ids[0]}`,
                patternId,
                label: `${patternLabel} × ${run.repeatCount}`,
                patternLabel,
                operationIds: ids,
                instanceIndex,
                instanceCount: run.repeatCount,
            });
        }
    });

    return instances;
}

export function sumOptional(values: readonly (number | undefined)[]): number {
    let total = 0;
    for (const value of values) {
        if (value !== undefined && Number.isFinite(value)) {
            total += value;
        }
    }
    return total;
}
