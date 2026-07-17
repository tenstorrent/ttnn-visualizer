// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { memo } from 'react';
import { Button, ButtonVariant, Size, Spinner, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/MlirExpandCollapseControls.scss';

export interface MlirExpandCollapseControlsProps {
    namespaceCount: number;
    expandedCount: number;
    onExpandAll: () => void;
    onCollapseAll: () => void;
    // Worker rebuild in flight: lock the buttons and show progress.
    isBuilding?: boolean;
    nodeCount?: number;
}

const MlirExpandCollapseControlsInner = ({
    namespaceCount,
    expandedCount,
    onExpandAll,
    onCollapseAll,
    isBuilding = false,
    nodeCount,
}: MlirExpandCollapseControlsProps) => {
    const canExpand = !isBuilding && namespaceCount > 0 && expandedCount < namespaceCount;
    const canCollapse = !isBuilding && expandedCount > 0;
    return (
        <div className='mlir-expand-collapse-controls'>
            <Tooltip
                content='Expand every subgraph and re-lay out'
                compact
            >
                <Button
                    size={Size.SMALL}
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.EXPAND_ALL}
                    text='Expand all'
                    disabled={!canExpand}
                    aria-label='Expand all subgraphs'
                    onClick={onExpandAll}
                />
            </Tooltip>
            <Tooltip
                content='Collapse every subgraph back to the top-level anchors'
                compact
            >
                <Button
                    size={Size.SMALL}
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.COLLAPSE_ALL}
                    text='Collapse all'
                    disabled={!canCollapse}
                    aria-label='Collapse all subgraphs'
                    onClick={onCollapseAll}
                />
            </Tooltip>
            {isBuilding && (
                <span
                    className='mlir-layout-status'
                    role='status'
                >
                    <Spinner size={14} />
                    <span>Laying out{typeof nodeCount === 'number' ? ` ${nodeCount} nodes` : ''}…</span>
                </span>
            )}
        </div>
    );
};

const MlirExpandCollapseControls = memo(MlirExpandCollapseControlsInner);
MlirExpandCollapseControls.displayName = 'MlirExpandCollapseControls';

export default MlirExpandCollapseControls;
