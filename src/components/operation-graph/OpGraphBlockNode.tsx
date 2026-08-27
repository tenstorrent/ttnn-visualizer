// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import OpGraphBlockExpander from './OpGraphBlockExpander';
import type { OpGraphFlowNode } from './opGraphTypes';

const OpGraphBlockNode = memo(({ data }: NodeProps<OpGraphFlowNode>) => {
    const instanceId = data.blockInstanceId;
    const opCount = data.opCount ?? 0;
    if (instanceId === undefined) {
        return null;
    }

    return (
        <>
            <Handle
                type='target'
                position={Position.Top}
            />
            <div className='op-graph-node-label'>{data.label}</div>
            <div className='op-graph-node-file'>{data.fileIdentifier}</div>
            <OpGraphBlockExpander
                instanceId={instanceId}
                opCount={opCount}
                isExpanded={false}
            />
            {data.buriedMatchCount ? (
                <span
                    className='op-graph-node-buried-badge'
                    title={`${data.buriedMatchCount} filter ${
                        data.buriedMatchCount === 1 ? 'match' : 'matches'
                    } inside`}
                >
                    {`+${data.buriedMatchCount}`}
                </span>
            ) : null}
            <Handle
                type='source'
                position={Position.Bottom}
            />
        </>
    );
});

OpGraphBlockNode.displayName = 'OpGraphBlockNode';

export default OpGraphBlockNode;
