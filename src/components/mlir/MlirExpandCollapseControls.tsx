// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/MlirExpandCollapseControls.scss';

export interface MlirExpandCollapseControlsProps {
    namespaceCount: number;
    expandedCount: number;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

const MlirExpandCollapseControls = ({
    namespaceCount,
    expandedCount,
    onExpandAll,
    onCollapseAll,
}: MlirExpandCollapseControlsProps) => {
    const canExpand = namespaceCount > 0 && expandedCount < namespaceCount;
    const canCollapse = expandedCount > 0;
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
        </div>
    );
};

export default MlirExpandCollapseControls;
