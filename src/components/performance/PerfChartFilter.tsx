// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Checkbox } from '@blueprintjs/core';
import { useEffect, useState } from 'react';
import 'styles/components/PerfChartFilter.scss';
import { Marker } from '../../definitions/PerfTable';

interface PerfChartFilterProps {
    opCodeOptions: Marker[];
    selectedOpCodes: Marker[];
    updateOpCodes: (opCodes: Marker[]) => void;
}

function PerfChartFilter({ opCodeOptions, selectedOpCodes, updateOpCodes }: PerfChartFilterProps) {
    const [isAllSelected, setIsAllSelected] = useState(true);
    const [isIndeterminate, setIsIndeterminate] = useState(false);

    useEffect(() => {
        if (selectedOpCodes.length === 0) {
            setIsAllSelected(false);
            setIsIndeterminate(false);
        }

        if (selectedOpCodes.length > 0 && selectedOpCodes.length < opCodeOptions.length) {
            setIsAllSelected(false);
            setIsIndeterminate(true);
        }

        if (selectedOpCodes.length === opCodeOptions.length) {
            setIsAllSelected(true);
            setIsIndeterminate(false);
        }
    }, [selectedOpCodes, opCodeOptions]);

    const handleAllSelectedChange = () => {
        if (isAllSelected) {
            updateOpCodes([]);
        } else {
            updateOpCodes(opCodeOptions);
        }
    };

    const getAllSelectedLabel = () => {
        if (isAllSelected) {
            return 'Deselect all';
        }

        return 'Select all';
    };

    return (
        <aside className='op-code-menu-container'>
            <div className='op-code-menu'>
                <p className='header'>
                    <strong>Operation codes</strong>
                </p>

                <div className='option select-all'>
                    <Checkbox
                        checked={isAllSelected}
                        indeterminate={isIndeterminate}
                        id='select-all'
                        onChange={handleAllSelectedChange}
                        label={getAllSelectedLabel()}
                    />
                </div>

                {opCodeOptions.map((option) => (
                    <div
                        className='option'
                        key={option.opCode}
                    >
                        <Checkbox
                            checked={selectedOpCodes.map((selected) => selected.opCode).includes(option.opCode)}
                            id={option.opCode}
                            key={option.opCode}
                            label={option.opCode}
                            onChange={() => {
                                const newSelectedOpCodes = selectedOpCodes.includes(option)
                                    ? selectedOpCodes.filter((code) => code !== option)
                                    : [...selectedOpCodes, option];

                                updateOpCodes(newSelectedOpCodes);
                            }}
                        />

                        <div
                            className='memory-color-block'
                            style={{
                                backgroundColor: option.colour,
                            }}
                        />
                    </div>
                ))}
            </div>
        </aside>
    );
}

export default PerfChartFilter;
