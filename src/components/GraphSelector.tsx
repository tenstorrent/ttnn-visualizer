// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC } from 'react';
import PopoverMenu from './PopoverMenu';

interface GraphSelectorProps {
    disabled?: boolean;
    label?: string;
    onSelectGraph: (graph: string) => void;
}

const GraphSelector: FC<GraphSelectorProps> = ({ disabled = false, label, onSelectGraph }) => {
    // const { getActiveGraphName, graphOnChipList } = useContext(GraphOnChipContext);
    // const selectedGraph = getActiveGraphName();
    // const availableGraphs = Object.keys(graphOnChipList);
    const availableGraphs = ['hey', 'ho', 'lets go'];
    const selectedGraph = '';

    return (
        <PopoverMenu
            label={selectedGraph || (label ?? 'Select graph')}
            options={availableGraphs}
            selectedItem={availableGraphs[0]}
            onSelectItem={(graph) => {
                onSelectGraph(graph);
            }}
            disabled={disabled || availableGraphs?.length === 0}
        />
    );
};

export default GraphSelector;
