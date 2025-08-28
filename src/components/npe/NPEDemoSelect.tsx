// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC } from 'react';
import { Button, ButtonVariant, MenuItem } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { NPEData } from '../../model/NPEModel';
import npeDemoDataSinglechip from '../../assets/data/npe-demo-single.json';
import npeDemoDataMultichip from '../../assets/data/npe-demo-multi.json';

enum NPEDemo {
    SINGLE_CHIP = 'singlechip',
    MULTI_CHIP = 'multichip',
}

export interface NPEDemoData {
    reportFile: NPEDemo;
    label: string;
    data: NPEData;
}

const NPE_DEMO_DATA: NPEDemoData[] = [
    {
        reportFile: NPEDemo.SINGLE_CHIP,
        data: npeDemoDataSinglechip as unknown as NPEData,
        label: 'NPE single chip demo',
    },
    {
        reportFile: NPEDemo.MULTI_CHIP,
        data: npeDemoDataMultichip as unknown as NPEData,
        label: 'NPE multichip demo',
    },
];

const NPEDemoSelect: FC<{
    selectedDemo: NPEDemoData | null;
    setSelectedDemo: (demo: NPEDemoData | null) => void;
    setDemoData: (data: NPEData | null) => void;
}> = ({ selectedDemo, setSelectedDemo, setDemoData }) => {
    const renderItem: ItemRenderer<NPEDemoData> = (item, { handleClick, modifiers }) => (
        <MenuItem
            key={item.reportFile}
            textClassName='folder-picker-label'
            text={item.label}
            labelClassName='folder-picker-name-label'
            active={item.reportFile === selectedDemo?.reportFile}
            roleStructure='listoption'
            disabled={modifiers.disabled}
            onClick={handleClick}
            icon={IconNames.SAVED}
        />
    );

    return (
        <Select
            className=''
            items={NPE_DEMO_DATA}
            itemRenderer={renderItem}
            noResults={
                <MenuItem
                    disabled
                    text='No results.'
                    roleStructure='listoption'
                />
            }
            onItemSelect={(item) => {
                setSelectedDemo(item);
                setDemoData(item.data);
            }}
        >
            {selectedDemo ? (
                <Button
                    className='folder-picker-button'
                    text={selectedDemo.label}
                    alignText='start'
                    icon={IconNames.SAVED}
                    endIcon={IconNames.CARET_DOWN}
                    variant={ButtonVariant.OUTLINED}
                />
            ) : (
                <Button
                    className='folder-picker-button'
                    text='Select a demo NPE report'
                    alignText='start'
                    icon={IconNames.DOCUMENT_OPEN}
                    endIcon={IconNames.CARET_DOWN}
                    variant={ButtonVariant.OUTLINED}
                />
            )}
        </Select>
    );
};

export default NPEDemoSelect;
