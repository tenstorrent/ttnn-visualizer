// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import OpGraphDeviceOpExpander from './OpGraphDeviceOpExpander';
import { type OpGraphFlowNode, isExpandableOperation } from './opGraphTypes';

const OpGraphNode = memo(({ data }: NodeProps<OpGraphFlowNode>) => (
    <>
        <Handle
            type='target'
            position={Position.Top}
        />
        <div className='op-graph-node-label'>{data.label}</div>
        {data.fileIdentifier ? <div className='op-graph-node-file'>{data.fileIdentifier}</div> : null}
        {isExpandableOperation(data.deviceOperationCount) ? (
            <OpGraphDeviceOpExpander
                operationId={data.operationId}
                count={data.deviceOperationCount}
                isExpanded={false}
            />
        ) : null}
        <Handle
            type='source'
            position={Position.Bottom}
        />
    </>
));

OpGraphNode.displayName = 'OpGraphNode';

export default OpGraphNode;
