// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { buildOpGraph } from './opGraphBuilder';
import {
    type OpGraphSourceOperation,
    type OpGraphWorkerInboundMessage,
    OpGraphWorkerMessageType,
} from './opGraphTypes';

let sourceVersion = -1;
let operations: OpGraphSourceOperation[] = [];

onmessage = (event: MessageEvent<OpGraphWorkerInboundMessage>) => {
    const message = event.data;

    if (message.type === OpGraphWorkerMessageType.SET_GRAPH) {
        sourceVersion = message.sourceVersion;
        operations = message.operations;
        return;
    }

    // A build for a superseded source would lay out the wrong report; the view
    // discards mismatched replies too, but bailing here saves the layout pass.
    if (message.sourceVersion !== sourceVersion) {
        return;
    }

    try {
        const graph = buildOpGraph(operations, {
            hideDeallocate: message.hideDeallocate,
            compact: message.compact,
        });
        postMessage({
            type: OpGraphWorkerMessageType.BUILT,
            sourceVersion: message.sourceVersion,
            requestId: message.requestId,
            graph,
        });
    } catch (error) {
        postMessage({
            type: OpGraphWorkerMessageType.ERROR,
            requestId: message.requestId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
