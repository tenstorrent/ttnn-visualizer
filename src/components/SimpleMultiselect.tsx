// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { ItemRenderer, MultiSelect } from '@blueprintjs/select';
import { MenuItem } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

const renderOption: ItemRenderer<string> = (item, { modifiers, handleClick }) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    return (
        <MenuItem
            key={item}
            active={modifiers.active}
            disabled={modifiers.disabled}
            icon={IconNames.CUBE}
            text={item}
            onClick={handleClick}
        />
    );
};

const SimpleMultiselect = ({
    label,
    optionList,
    onUpdateHandler,
}: {
    label: string;
    optionList: string[];
    onUpdateHandler: (values: string[]) => void;
}) => {
    const [selected, setSelected] = useState<string[]>([]);
    const handleItemSelect = (item: string) => {
        if (!selected.includes(item)) {
            const list = [...selected, item];
            setSelected(list);
            onUpdateHandler(list);
        }
    };

    const handleItemRemove = (item: string, index: number) => {
        setSelected((prev) => {
            const list = prev.filter((_, i) => i !== index);
            onUpdateHandler(list);
            return list;
        });
    };

    return (
        <MultiSelect<string>
            items={optionList}
            itemRenderer={renderOption}
            onItemSelect={handleItemSelect}
            selectedItems={selected}
            itemDisabled={(item) => selected.includes(item)}
            placeholder={label}
            tagRenderer={(item) => item}
            onRemove={handleItemRemove}
            resetOnSelect
            disabled={false}
            query=''
            onQueryChange={() => {}}
            tagInputProps={{
                inputProps: { readOnly: true },
            }}
        />
    );
};
export default SimpleMultiselect;
