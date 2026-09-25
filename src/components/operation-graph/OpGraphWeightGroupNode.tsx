// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import OpGraphBlockExpander from './OpGraphBlockExpander';
import type { OpGraphFlowNode } from './opGraphTypes';

/**
 * An unrolled weight fan: the members, inside the chrome that can fold them again.
 *
 * The fold pill lives on the collapsed block node, and unrolling replaces that node
 * with the members — so the affordance went with it and the only way back was the
 * toolbar switch, which resets every fan rather than this one. Keeping the fan's
 * `instanceId` on a container means the reader's decision has somewhere to live and
 * the expansion set needs no new state. #2028
 *
 * Handles are declared rather than inherited, the same reason `OpGraphDeviceGroupNode`
 * declares them: an edge pointing at a node with no handle renders as a no-op.
 */
const OpGraphWeightGroupNode = memo(({ data }: NodeProps<OpGraphFlowNode>) => (
    <>
        <Handle
            type='target'
            position={Position.Top}
        />
        <div className='op-graph-group-header'>
            <div className='op-graph-group-heading'>
                <div className='op-graph-node-label'>{data.label}</div>
                {/* The same stats the collapsed pill carries. Dropping them on unroll
                    would make the fold pill look like it puts something else back. */}
                <div className='op-graph-node-meta'>{data.metaLine}</div>
            </div>
            <OpGraphBlockExpander
                instanceId={data.blockInstanceId ?? ''}
                opCount={data.opCount ?? 0}
                isExpanded
            />
        </div>
        <Handle
            type='source'
            position={Position.Bottom}
        />
    </>
));

OpGraphWeightGroupNode.displayName = 'OpGraphWeightGroupNode';

export default OpGraphWeightGroupNode;
