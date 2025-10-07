// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Checkbox, MenuItem } from '@blueprintjs/core';
import { ItemPredicate, MultiSelect } from '@blueprintjs/select';
import { Dispatch, SetStateAction, useCallback, useMemo } from 'react';

type MultiSelectFieldProps<T, K extends keyof T> = {
    keyName: K;
    options: T[];
    placeholder: string;
    values: T[K][];
    updateHandler: Dispatch<SetStateAction<T[K][]>>;
    labelFormatter?: (value: T[K]) => string;
};

const MultiSelectField = <T, K extends keyof T>({
    keyName,
    options,
    placeholder,
    values,
    updateHandler,
    labelFormatter,
}: MultiSelectFieldProps<T, K>) => {
    const updateMultiSelect = useCallback(
        (updatedFilter: T[K]) => {
            updateHandler((currentFilters) => {
                if (currentFilters.includes(updatedFilter)) {
                    return currentFilters.filter((item) => item !== updatedFilter);
                }
                return [...currentFilters, updatedFilter];
            });
        },
        [updateHandler],
    );

    const renderOption = useCallback(
        (option: T[K]) => (
            <Option
                key={String(option)}
                type={option}
                label={labelFormatter ? labelFormatter(option) : String(option)}
                values={values}
                updateHandler={updateMultiSelect}
            />
        ),
        [values, updateMultiSelect, labelFormatter],
    );

    const formattedOptions = useMemo((): T[K][] => {
        const uniqueValues = new Set(
            options.map((option) => option[keyName]).filter((val): val is T[K] => val != null && val !== ''),
        );

        return Array.from(uniqueValues).sort((a, b) => (a > b ? 1 : -1));
    }, [options, keyName]);

    const filterPredicate: ItemPredicate<T[K]> = useCallback(
        (query, selected) => !query || String(selected).toLowerCase().includes(query.toLowerCase()),
        [],
    );

    return (
        <MultiSelect<T[K]>
            items={formattedOptions}
            placeholder={placeholder}
            onItemSelect={(selectedType) => updateMultiSelect(selectedType)}
            selectedItems={formattedOptions.filter((option) => values.includes(option))}
            itemRenderer={renderOption}
            tagRenderer={(selected) => (labelFormatter ? labelFormatter(selected) : String(selected))}
            onRemove={(selected) => updateMultiSelect(selected)}
            itemPredicate={filterPredicate}
            noResults={RenderNoResults}
            resetOnSelect
        />
    );
};

type OptionProps<T> = {
    type: T;
    values: T[];
    updateHandler: (type: T) => void;
    label?: string;
};

const Option = <T,>({ type, values, updateHandler, label }: OptionProps<T>) => {
    return (
        <li>
            <Checkbox
                label={label || String(type)}
                checked={values.includes(type)}
                onClick={() => updateHandler(type)}
            />
        </li>
    );
};

const RenderNoResults = (
    <MenuItem
        text='No results.'
        roleStructure='listoption'
        disabled
    />
);

export default MultiSelectField;
