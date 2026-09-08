// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { type CSSProperties, memo, useState } from 'react';
import classNames from 'classnames';
import { Button, ButtonVariant, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { GRAPH_COLORS } from '../../definitions/GraphColors';
import 'styles/components/MlirNodeColorLegend.scss';

// Colours come straight from GRAPH_COLORS so the legend can't drift from what's
// painted. `swatch: 'ring'` mirrors the selected node's box-shadow (not a fill).
interface LegendItem {
    id: string;
    label: string;
    color: string;
    swatch: 'fill' | 'ring';
}

const LEGEND_ITEMS: readonly LegendItem[] = [
    { id: 'op', label: 'Operation', color: GRAPH_COLORS.opNode, swatch: 'fill' },
    { id: 'group', label: 'Subgraph / group', color: GRAPH_COLORS.group, swatch: 'fill' },
    { id: 'section', label: 'Section group', color: GRAPH_COLORS.sectionGroup, swatch: 'fill' },
    { id: 'input', label: 'Feeds selection', color: GRAPH_COLORS.inputNode, swatch: 'fill' },
    { id: 'output', label: 'Consumed by selection', color: GRAPH_COLORS.outputNode, swatch: 'fill' },
    { id: 'selected', label: 'Selected node', color: GRAPH_COLORS.selected, swatch: 'ring' },
];

const MlirNodeColorLegendInner = () => {
    // Default collapsed so it doesn't crowd the graph.
    const [expanded, setExpanded] = useState(false);

    return (
        <div className='mlir-node-color-legend'>
            <Button
                className='mlir-node-color-legend-toggle'
                size={Size.SMALL}
                variant={ButtonVariant.MINIMAL}
                icon={expanded ? IconNames.CHEVRON_DOWN : IconNames.CHEVRON_UP}
                text='Legend'
                aria-expanded={expanded}
                aria-label={expanded ? 'Hide node colour legend' : 'Show node colour legend'}
                onClick={() => setExpanded((value) => !value)}
            />

            {expanded && (
                <ul className='mlir-node-color-legend-items'>
                    {LEGEND_ITEMS.map((item) => (
                        <li
                            key={item.id}
                            className='mlir-node-color-legend-item'
                        >
                            <span
                                className={classNames('mlir-node-color-legend-swatch', {
                                    'is-ring': item.swatch === 'ring',
                                })}
                                style={{ '--legend-swatch-color': item.color } as CSSProperties}
                            />
                            <span className='mlir-node-color-legend-label'>{item.label}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const MlirNodeColorLegend = memo(MlirNodeColorLegendInner);
MlirNodeColorLegend.displayName = 'MlirNodeColorLegend';

export default MlirNodeColorLegend;
