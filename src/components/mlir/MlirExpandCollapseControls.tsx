// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Size, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/MlirExpandCollapseControls.scss';

export interface MlirExpandCollapseControlsProps {
    subgraphCount: number;
    expandedCount: number;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

// Sits in the top-left cluster next to `MlirOpFilter` and
// `MlirNodeBodyToggles` — grouping this with the filter-adjacent widgets
// keeps all graph-shaping controls together and leaves the bottom-left zoom
// widget alone.
//
// Disable rules keep the buttons truthful:
//  - `Expand all`   grays out when the graph has no collapsible namespaces
//                   OR every collapsible namespace is already expanded.
//  - `Collapse all` grays out when nothing is expanded (already at
//                   top-level anchors, so the click would be a no-op).
const MlirExpandCollapseControls = ({
    subgraphCount,
    expandedCount,
    onExpandAll,
    onCollapseAll,
}: MlirExpandCollapseControlsProps) => {
    const canExpand = subgraphCount > 0 && expandedCount < subgraphCount;
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
