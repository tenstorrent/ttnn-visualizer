// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { DEALLOCATE_OP_NAME_LIST } from '../../definitions/Deallocate';
import { estimateOpNodeSize, layoutOpGraph } from './opGraphLayout';
import {
    type OpGraphBuildOptions,
    type OpGraphBuiltGraph,
    OpGraphEdgeType,
    type OpGraphFlowEdge,
    type OpGraphFlowNode,
    OpGraphNodeType,
    type OpGraphSourceOperation,
} from './opGraphTypes';

interface CandidateEdge {
    source: number;
    target: number;
    label: string;
}

const isDeallocate = (name: string): boolean => DEALLOCATE_OP_NAME_LIST.includes(name.toLowerCase());

function collectCandidateEdges(operations: OpGraphSourceOperation[]): CandidateEdge[] {
    const candidates: CandidateEdge[] = [];
    for (const operation of operations) {
        for (const output of operation.outputs) {
            for (const consumer of output.consumers) {
                candidates.push({ source: operation.id, target: consumer, label: output.edgeLabel });
            }
        }
    }
    return candidates;
}

export function buildOpGraph(
    operations: OpGraphSourceOperation[],
    { hideDeallocate, isCompact }: OpGraphBuildOptions,
): OpGraphBuiltGraph {
    const candidates = collectCandidateEdges(operations);

    // Connectivity is decided before the deallocate filter so hiding deallocate
    // ops cannot drop their neighbours or pull in ops that were always isolated.
    const connected = new Set<number>();
    for (const candidate of candidates) {
        connected.add(candidate.source);
        connected.add(candidate.target);
    }

    const kept = new Set<number>();
    const nodes: OpGraphFlowNode[] = [];
    for (const operation of operations) {
        if (connected.has(operation.id) && !(hideDeallocate && isDeallocate(operation.name))) {
            kept.add(operation.id);
            const label = `${operation.id} ${operation.name}`;
            nodes.push({
                id: String(operation.id),
                type: OpGraphNodeType.OP,
                position: { x: 0, y: 0 },
                ...estimateOpNodeSize(label, operation.fileIdentifier),
                data: {
                    operationId: operation.id,
                    label,
                    fileIdentifier: operation.fileIdentifier,
                    filterString: operation.name,
                },
            });
        }
    }

    const parallelCountByPair = new Map<string, number>();
    const edges: OpGraphFlowEdge[] = [];
    for (const candidate of candidates) {
        if (kept.has(candidate.source) && kept.has(candidate.target)) {
            const pair = `${candidate.source}-${candidate.target}`;
            const parallelIndex = parallelCountByPair.get(pair) ?? 0;
            parallelCountByPair.set(pair, parallelIndex + 1);
            edges.push({
                id: `${pair}-${parallelIndex}`,
                source: String(candidate.source),
                target: String(candidate.target),
                type: OpGraphEdgeType.OP,
                label: candidate.label,
                data: { parallelIndex },
            });
        }
    }

    const positions = layoutOpGraph(
        nodes.map((node) => ({ id: node.id, width: node.width ?? 0, height: node.height ?? 0 })),
        edges,
        isCompact,
    );

    return {
        nodes: nodes.map((node) => ({ ...node, position: positions.get(node.id) ?? node.position })),
        edges,
    };
}
