// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { Edge } from 'vis-network';
import { OperationDescription } from './model/APIData';

interface WorkerData {
    operationList: OperationDescription[];
}

// eslint-disable-next-line no-restricted-globals
self.onmessage = function handleMessage(event: MessageEvent<WorkerData>) {
    const { operationList } = event.data;
    const edges: Edge[] = operationList.flatMap((op) =>
        op.outputs.flatMap((tensor) =>
            tensor.consumers.map((consumerId) => ({
                from: op.id,
                to: consumerId,
                arrows: 'to',
                label: `${tensor.id}`,
            })),
        ),
    );

    const connectedNodeIds = new Set<number>();
    edges.forEach(({ from, to }) => {
        connectedNodeIds.add(from as number);
        connectedNodeIds.add(to as number);
    });

    const nodes = operationList
        .filter((op) => connectedNodeIds.has(op.id))
        .map((op) => ({
            id: op.id,
            label: `${op.id} ${op.name}`,
            shape: 'box',
        }));

    postMessage({ edges, nodes });
};
