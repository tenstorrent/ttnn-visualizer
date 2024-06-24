// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';

import { Button, Menu, MenuItem, Popover } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

interface PopoverMenuProps {
    label: string;
    options: string[];
    selectedItem: string | null;
    onSelectItem: (graphName: string) => void;
    disabled: boolean;
}

const PopoverMenu = ({
    label,
    options,
    selectedItem,
    onSelectItem,
    disabled,
}: PopoverMenuProps): React.ReactElement => {
    return (
        <Popover
            content={
                <div className='popover-list-picker'>
                    <h3>{label}</h3>
                    <Menu>
                        {options.map((item) => (
                            <MenuItem
                                key={item}
                                selected={selectedItem === item}
                                onClick={(_e) => onSelectItem(item)}
                                text={item}
                            />
                        ))}
                    </Menu>
                </div>
            }
            disabled={disabled}
            placement='right'
        >
            <Button icon={IconNames.GRAPH} disabled={disabled}>
                {label}
            </Button>
        </Popover>
    );
};

export default PopoverMenu;
