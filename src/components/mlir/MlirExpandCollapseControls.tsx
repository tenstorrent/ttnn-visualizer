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
    isBuilding?: boolean;
    nodeCount?: number;
}

// Single source of truth for the rebuild-in-flight status copy, shared with the
// specs so the visible text and the assertions cannot drift apart. Co-located
// with its only consumer; the exported helper is an HMR-only concern, not a
// second component.
// eslint-disable-next-line react-refresh/only-export-components
export const layoutStatusLabel = (nodeCount?: number): string =>
    `Laying out${typeof nodeCount === 'number' ? ` ${nodeCount} nodes` : ''}…`;

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
                    <span>{layoutStatusLabel(nodeCount)}</span>
                </span>
            )}
        </div>
    );
};

const MlirExpandCollapseControls = memo(MlirExpandCollapseControlsInner);
MlirExpandCollapseControls.displayName = 'MlirExpandCollapseControls';

export default MlirExpandCollapseControls;
