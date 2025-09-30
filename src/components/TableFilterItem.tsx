// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Checkbox } from '@blueprintjs/core';
import 'styles/components/TableFilterItem.scss';
import { TableFilterValue } from '../hooks/useTableFilter';

const TableFilterItem = ({
    type,
    activeFilters,
    onChange,
    label,
}: {
    type: string;
    activeFilters: TableFilterValue[];
    onChange: (type: TableFilterValue) => void;
    label?: string;
}) => {
    return (
        <li>
            <Checkbox
                className='table-filter-checkbox'
                label={label || type}
                checked={activeFilters.includes(type)}
                onClick={() => onChange(type)}
            />
        </li>
    );
};

export default TableFilterItem;
