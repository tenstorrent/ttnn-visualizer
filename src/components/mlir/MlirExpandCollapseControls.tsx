// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ControlButton } from '@xyflow/react';

export interface MlirExpandCollapseControlsProps {
    subgraphCount: number;
    expandedCount: number;
    onExpandAll: () => void;
    onCollapseAll: () => void;
}

// Renders as children of React Flow's `<Controls>` widget so the two buttons
// sit right underneath the built-in zoom / fit / lock cluster in the
// bottom-left corner — matching #1715's "next to the existing layout / zoom
// controls" requirement.
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
        <>
            <ControlButton
                onClick={onExpandAll}
                disabled={!canExpand}
                title='Expand all subgraphs'
                aria-label='Expand all subgraphs'
            >
                <Icon icon={IconNames.EXPAND_ALL} />
            </ControlButton>
            <ControlButton
                onClick={onCollapseAll}
                disabled={!canCollapse}
                title='Collapse all subgraphs'
                aria-label='Collapse all subgraphs'
            >
                <Icon icon={IconNames.COLLAPSE_ALL} />
            </ControlButton>
        </>
    );
};

export default MlirExpandCollapseControls;
