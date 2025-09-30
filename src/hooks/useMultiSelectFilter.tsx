// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import { Checkbox } from '@blueprintjs/core';

export type MultiSelectValue = string | number; // May need to expand this eventually

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useMultiSelectFilter = <T extends Record<string, any>>(key: keyof T, data: T[]) => {
    const [activeMultiSelectFilters, setActiveMultiSelectFilters] = useState<MultiSelectValue[]>([]);

    const getMultiSelectOptions = (): MultiSelectValue[] =>
        [...new Set(data?.map((row) => (row[key] !== null ? row[key] : '')))]
            .filter((value) => value !== '')
            .sort((a, b) => (a > b ? 1 : -1));

    const updateMultiSelect = (updatedFilter: MultiSelectValue) => {
        setActiveMultiSelectFilters((currentFilters: MultiSelectValue[]) => {
            if (currentFilters.includes(updatedFilter)) {
                return currentFilters.filter((item) => item !== updatedFilter);
            }
            return [...currentFilters, updatedFilter];
        });
    };

    //
    const OptionComponent = (type: MultiSelectValue, label?: string) => {
        return (
            <li>
                <Checkbox
                    label={label || String(type)}
                    checked={activeMultiSelectFilters.includes(type)}
                    onClick={() => updateMultiSelect(type)}
                />
            </li>
        );
    };

    return {
        getMultiSelectOptions,
        updateMultiSelect,
        activeMultiSelectFilters,
        OptionComponent,
    };
};

export default useMultiSelectFilter;
