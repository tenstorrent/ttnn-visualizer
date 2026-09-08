// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import type {
    IndexedAttr,
    IndexedEdge,
    IndexedPortMetadata,
    SourceNode,
} from '../../src/components/mlir/mlirGraphTypes';

/** Concise SourceNode constructor used by every MLIR fixture. */
export function makeNode(opts: {
    id: string;
    label: string;
    namespace?: string;
    attrs?: IndexedAttr[];
    incomingEdges?: IndexedEdge[];
    outputsMetadata?: IndexedPortMetadata[];
    pinToGroupTop?: boolean;
}): SourceNode {
    return {
        id: opts.id,
        label: opts.label,
        namespace: opts.namespace ?? '',
        attrs: opts.attrs ?? [],
        incomingEdges: opts.incomingEdges ?? [],
        outputsMetadata: opts.outputsMetadata ?? [],
        config: opts.pinToGroupTop ? { pinToGroupTop: true } : null,
    };
}

/** IndexedEdge constructor. Defaults output/input ports to '0'. */
export function edge(sourceId: string, options: { outputId?: string; inputId?: string } = {}): IndexedEdge {
    return {
        sourceNodeId: sourceId,
        sourceNodeOutputId: options.outputId ?? '0',
        targetNodeInputId: options.inputId ?? '0',
    };
}

/** Convenience: K_n clique (every node connected to every other node). */
export function clique(prefix: string, count: number, baseNamespace = ''): SourceNode[] {
    const ids = Array.from({ length: count }, (_, i) => `${prefix}_${i}`);
    return ids.map((id, idx) =>
        makeNode({
            id,
            label: 'op',
            namespace: baseNamespace,
            incomingEdges: ids.filter((_, otherIdx) => otherIdx < idx).map((src) => edge(src)),
        }),
    );
}

/** Convenience: linear chain prefix_0 → prefix_1 → ... → prefix_{count-1}. */
export function chain(prefix: string, count: number, baseNamespace = ''): SourceNode[] {
    return Array.from({ length: count }, (_, i) =>
        makeNode({
            id: `${prefix}_${i}`,
            label: 'op',
            namespace: baseNamespace,
            incomingEdges: i > 0 ? [edge(`${prefix}_${i - 1}`)] : [],
        }),
    );
}
