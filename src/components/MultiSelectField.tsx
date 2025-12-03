// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Checkbox, MenuItem } from '@blueprintjs/core';
import { ItemPredicate, MultiSelect } from '@blueprintjs/select';
import { Dispatch, SetStateAction, useCallback, useMemo } from 'react';
import HighlightedText from './HighlightedText';

type MultiSelectFieldProps<T, K extends keyof T> = {
    keyName: K;
    options: T[];
    placeholder: string;
    values: T[K][];
    updateHandler: Dispatch<SetStateAction<T[K][]>>;
    labelFormatter?: (value: T[K]) => string;
    disabled?: boolean;
};

const MultiSelectField = <T, K extends keyof T>({
    keyName,
    options,
    placeholder,
    values,
    updateHandler,
    labelFormatter,
    disabled,
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
        (option: T[K], { query }: { query: string }) => (
            <Option
                key={String(option)}
                query={query}
                type={option}
                label={labelFormatter ? labelFormatter(option) : String(option)}
                values={values}
                updateHandler={updateMultiSelect}
            />
        ),
        [values, updateMultiSelect, labelFormatter],
    );

    const formattedOptions = useMemo((): T[K][] => {
        const keyData = options.map((option) => option[keyName]);
        const uniqueValues = new Set(keyData.filter((val): val is T[K] => val != null && val !== ''));
        const sortedOptions = Array.from(uniqueValues).sort((a, b) => (a > b ? 1 : -1));

        return sortedOptions;
    }, [options, keyName]);

    const filterPredicate: ItemPredicate<T[K]> = useCallback(
        (query, selected) =>
            !query ||
            (labelFormatter ? labelFormatter(selected) : String(selected)).toLowerCase().includes(query.toLowerCase()),
        [labelFormatter],
    );

    const selectedItems = useMemo(
        () => formattedOptions.filter((option) => values.includes(option)),
        [formattedOptions, values],
    );

    return (
        <MultiSelect<T[K]>
            items={formattedOptions}
            placeholder={placeholder}
            onItemSelect={(selectedType) => updateMultiSelect(selectedType)}
            selectedItems={selectedItems}
            itemRenderer={renderOption}
            tagRenderer={(selected) => (labelFormatter ? labelFormatter(selected) : String(selected))}
            onRemove={(selected) => updateMultiSelect(selected)}
            itemPredicate={filterPredicate}
            noResults={RenderNoResults}
            resetOnSelect
            disabled={disabled}
        />
    );
};

type OptionProps<T> = {
    type: T;
    values: T[];
    updateHandler: (type: T) => void;
    label?: string;
    query?: string;
};

const Option = <T,>({ type, values, updateHandler, label, query }: OptionProps<T>) => {
    return (
        <li>
            <Checkbox
                labelElement={
                    <HighlightedText
                        text={label ?? String(type)}
                        filter={query || ''}
                    />
                }
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
