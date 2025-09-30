// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';
import TableFilterItem from '../components/TableFilterItem';

export type TableFilterValue = string; // May need to expand this eventually

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useTableFilter = <T extends Record<string, any>>(key: keyof T, data: T[]) => {
    const [activeFilters, setActiveFilters] = useState<TableFilterValue[]>([]);
    const getFilterOptions = (): TableFilterValue[] =>
        [...new Set(data?.map((row) => (row[key] !== null ? row[key] : '')))]
            .filter((value) => value !== '')
            .sort((a, b) => (a > b ? 1 : -1));

    const updateFilters = (updatedFilter: TableFilterValue) => {
        setActiveFilters((currentFilters: TableFilterValue[]) => {
            if (currentFilters.includes(updatedFilter)) {
                return currentFilters.filter((item) => item !== updatedFilter);
            }
            return [...currentFilters, updatedFilter];
        });
    };

    const OptionComponent = (type: TableFilterValue, label?: string) => {
        return (
            <TableFilterItem
                label={label}
                key={String(type)}
                type={String(type)}
                onChange={updateFilters}
                activeFilters={activeFilters}
            />
        );
    };

    return {
        getFilterOptions,
        updateFilters,
        activeFilters,
        OptionComponent,
    };
};

export default useTableFilter;
