// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Checkbox, Popover, PopoverInteractionKind, Position } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import { useMemo } from 'react';
import 'styles/components/PerfTableToolbar.scss';
import { ColumnDefinition, ColumnKeys, LOCKED_PERF_COLUMN_KEYS } from '../../definitions/PerfTable';
import { TEST_IDS } from '../../definitions/TestIds';
import { hiddenPerfTableColumnsAtom } from '../../store/app';

interface PerfTableToolbarProps {
    eligibleColumns: ColumnDefinition[];
}

function PerfTableToolbar({ eligibleColumns }: PerfTableToolbarProps) {
    const [hiddenColumns, setHiddenColumns] = useAtom(hiddenPerfTableColumnsAtom);

    const hiddenColumnKeys = useMemo(() => new Set(hiddenColumns), [hiddenColumns]);

    const handleColumnToggle = (columnKey: ColumnKeys, isVisible: boolean) => {
        if (LOCKED_PERF_COLUMN_KEYS.includes(columnKey)) {
            return;
        }

        setHiddenColumns((previousHiddenColumns) => {
            if (isVisible) {
                return previousHiddenColumns.filter((key) => key !== columnKey);
            }

            if (previousHiddenColumns.includes(columnKey)) {
                return previousHiddenColumns;
            }

            return [...previousHiddenColumns, columnKey];
        });
    };

    const handleResetColumns = () => {
        setHiddenColumns([]);
    };

    const popoverContent = (
        <div
            className='perf-column-picker'
            data-testid={TEST_IDS.PERF_COLUMN_PICKER}
        >
            <div className='perf-column-picker-header'>
                <strong>Table columns</strong>
                <Button
                    variant={ButtonVariant.MINIMAL}
                    size='small'
                    onClick={handleResetColumns}
                    disabled={hiddenColumns.length === 0}
                    data-testid={TEST_IDS.PERF_COLUMN_PICKER_RESET}
                >
                    Show all
                </Button>
            </div>

            {eligibleColumns.map((column) => {
                const isLocked = LOCKED_PERF_COLUMN_KEYS.includes(column.key);
                const isVisible = isLocked || !hiddenColumnKeys.has(column.key);

                return (
                    <Checkbox
                        className='column-selection'
                        key={column.key}
                        checked={isVisible}
                        disabled={isLocked}
                        label={column.name}
                        data-testid={`${TEST_IDS.PERF_COLUMN_PICKER_OPTION}-${column.key}`}
                        onChange={(event) => handleColumnToggle(column.key, event.currentTarget.checked)}
                    />
                );
            })}
        </div>
    );

    return (
        <div className='perf-table-toolbar'>
            <Popover
                content={popoverContent}
                interactionKind={PopoverInteractionKind.CLICK}
                position={Position.BOTTOM}
                usePortal={false}
            >
                <Button
                    icon={IconNames.COLUMN_LAYOUT}
                    text='Columns'
                    variant={ButtonVariant.OUTLINED}
                    data-testid={TEST_IDS.PERF_COLUMN_PICKER_TRIGGER}
                />
            </Popover>
        </div>
    );
}

export default PerfTableToolbar;
