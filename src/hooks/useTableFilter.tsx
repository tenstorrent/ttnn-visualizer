// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState } from 'react';
import TableFilterItem from '../components/TableFilterItem';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const useTableFilter = <T extends Record<string, any>>(key: keyof T, data: T[]) => {
    const [activeFilters, setActiveFilters] = useState<(string | number)[]>([]);
    const getFilterOptions = (): (string | number)[] =>
        [...new Set(data?.map((row) => (row[key] !== null ? row[key] : '')))].filter((value) => value !== '');

    const updateFilters = (updatedFilter: string | number) => {
        setActiveFilters((currentFilters: (string | number)[]) => {
            if (currentFilters.includes(updatedFilter)) {
                return currentFilters.filter((item) => item !== updatedFilter);
            }
            return [...currentFilters, updatedFilter];
        });
    };

    const FilterItem = (type: string | number, label?: string) => {
        return (
            <TableFilterItem
                label={label}
                key={type}
                type={type}
                onChange={updateFilters}
                activeFilters={activeFilters}
            />
        );
    };

    return {
        getFilterOptions,
        updateFilters,
        activeFilters,
        FilterItem,
    };
};

export default useTableFilter;
