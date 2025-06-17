// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Checkbox } from '@blueprintjs/core';
import 'styles/components/TableFilterItem.scss';

const TableFilterItem = ({
    type,
    activeFilters,
    onChange,
    label,
}: {
    type: string | number;
    activeFilters: (string | number)[];
    onChange: (type: string | number) => void;
    label?: string;
}) => {
    return (
        <li>
            <Checkbox
                className='table-filter-checkbox'
                label={label || String(type)}
                checked={activeFilters.includes(type)}
                onClick={() => onChange(type)}
            />
        </li>
    );
};

export default TableFilterItem;
