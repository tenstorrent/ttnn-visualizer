// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import OpGraphDeviceOpExpander from './OpGraphDeviceOpExpander';
import type { OpGraphFlowNode } from './opGraphTypes';

/**
 * An expanded operation: the same node, grown to hold its device operations. The
 * handles are declared rather than inherited — an edge pointing at a node with no
 * handle renders as a no-op, so without them every arrow into or out of an
 * expanded operation would silently disappear.
 */
const OpGraphDeviceGroupNode = memo(({ data }: NodeProps<OpGraphFlowNode>) => (
    <>
        <Handle
            type='target'
            position={Position.Top}
        />
        <div className='op-graph-group-header'>
            <div className='op-graph-group-heading'>
                <div className='op-graph-node-label'>{data.label}</div>
                {data.fileIdentifier ? <div className='op-graph-node-file'>{data.fileIdentifier}</div> : null}
            </div>
            <OpGraphDeviceOpExpander
                operationId={data.operationId}
                count={data.deviceOperationCount}
                isExpanded
            />
        </div>
        <Handle
            type='source'
            position={Position.Bottom}
        />
    </>
));

OpGraphDeviceGroupNode.displayName = 'OpGraphDeviceGroupNode';

export default OpGraphDeviceGroupNode;
