// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { ItemRenderer, MultiSelect } from '@blueprintjs/select';
import { Checkbox, MenuItem } from '@blueprintjs/core';

const SimpleMultiselect = ({
    label,
    optionList,
    onUpdateHandler,
    initialValue,
}: {
    label: string;
    optionList: string[];
    onUpdateHandler: (values: string[]) => void;
    initialValue?: string[];
}) => {
    const [selected, setSelected] = useState<string[]>(initialValue ?? []);
    const handleItemSelect = (item: string) => {
        let list: string[] = [];
        if (!selected.includes(item)) {
            list = [...selected, item];
        } else {
            list = selected.filter((v) => v !== item);
        }
        setSelected(list);
        onUpdateHandler(list);
    };

    const handleItemRemove = (_item: string, index: number) => {
        setSelected((prev) => {
            const list = prev.filter((_, i) => i !== index);
            onUpdateHandler(list);
            return list;
        });
    };

    const renderOption: ItemRenderer<string> = (item, { modifiers, handleClick }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            <Checkbox
                key={item}
                checked={selected.includes(item)}
                label={item}
                onClick={handleClick}
            />
        );
    };

    return (
        <MultiSelect<string>
            items={optionList}
            itemRenderer={renderOption}
            onItemSelect={handleItemSelect}
            selectedItems={selected}
            placeholder={label}
            tagRenderer={(item) => item}
            onRemove={handleItemRemove}
            resetOnSelect
            disabled={false}
            noResults={RenderNoResults}
            query=''
            onQueryChange={() => {}}
            tagInputProps={{
                inputProps: { readOnly: true },
            }}
        />
    );
};

const RenderNoResults = (
    <MenuItem
        text='No results.'
        roleStructure='listoption'
        disabled
    />
);
export default SimpleMultiselect;
