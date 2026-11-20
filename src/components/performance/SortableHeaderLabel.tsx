// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import classNames from 'classnames';
import { Button, ButtonVariant, Icon, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { SortingDirection } from '../../hooks/useSortTable';

type SortingColumn = string | number | null;

interface SortableHeaderLabelProps {
    columnKey: string;
    label: string;
    sortable?: boolean;
    sortingColumn: SortingColumn;
    sortDirection: SortingDirection | null;
    /** `useSortTable`'s `changeSorting`. */
    onSort: (column: SortingColumn) => (direction: SortingDirection | null) => void;
}

/**
 * A perf table column's header label, which sorts the column when it is sortable. A second
 * click on the sorted column flips its direction; another column keeps the current direction.
 */
const SortableHeaderLabel = ({
    columnKey,
    label,
    sortable = false,
    sortingColumn,
    sortDirection,
    onSort,
}: SortableHeaderLabelProps) => {
    if (!sortable) {
        return <span className='header-label no-button'>{label}</span>;
    }

    const isSorted = sortingColumn === columnKey;
    const isAscending = sortDirection === SortingDirection.ASC;
    const flippedDirection = isAscending ? SortingDirection.DESC : SortingDirection.ASC;

    return (
        <Button
            onClick={() => onSort(columnKey)(isSorted ? flippedDirection : sortDirection)}
            variant={ButtonVariant.MINIMAL}
            size={Size.SMALL}
        >
            <span className='header-label'>{label}</span>
            <Icon
                className={classNames('sort-icon', { 'is-active': isSorted })}
                icon={isSorted && isAscending ? IconNames.CARET_UP : IconNames.CARET_DOWN}
            />
        </Button>
    );
};

export default SortableHeaderLabel;
