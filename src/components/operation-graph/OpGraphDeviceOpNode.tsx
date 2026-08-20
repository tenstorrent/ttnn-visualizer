// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Handle, type NodeProps, Position } from '@xyflow/react';
import { memo } from 'react';
import type { OpGraphFlowNode } from './opGraphTypes';

const OpGraphDeviceOpNode = memo(({ data }: NodeProps<OpGraphFlowNode>) => (
    <>
        <Handle
            type='target'
            position={Position.Top}
        />
        <div className='op-graph-node-label'>{data.label}</div>
        <Handle
            type='source'
            position={Position.Bottom}
        />
    </>
));

OpGraphDeviceOpNode.displayName = 'OpGraphDeviceOpNode';

export default OpGraphDeviceOpNode;
