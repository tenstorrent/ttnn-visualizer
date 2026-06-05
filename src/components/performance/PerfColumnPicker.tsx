// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Checkbox, Popover, PopoverInteractionKind, Position } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import { useMemo } from 'react';
import 'styles/components/PerfReport.scss';
import { ColumnDefinition, ColumnKeys, LOCKED_PERF_COLUMN_KEYS } from '../../definitions/PerfTable';
import { TEST_IDS } from '../../definitions/TestIds';
import { userPerfColumnsAtom } from '../../store/app';

interface PerfColumnPickerProps {
    eligibleColumns: ColumnDefinition[];
}

function PerfColumnPicker({ eligibleColumns }: PerfColumnPickerProps) {
    const [userColumns, setUserColumns] = useAtom(userPerfColumnsAtom);

    const hiddenColumnKeys = useMemo(() => new Set(userColumns), [userColumns]);

    const handleColumnToggle = (columnKey: ColumnKeys, isVisible: boolean) => {
        if (LOCKED_PERF_COLUMN_KEYS.includes(columnKey)) {
            return;
        }

        setUserColumns((previousUserColumns) => {
            if (isVisible) {
                return previousUserColumns.filter((key) => key !== columnKey);
            }

            if (previousUserColumns.includes(columnKey)) {
                return previousUserColumns;
            }

            return [...previousUserColumns, columnKey];
        });
    };

    const handleResetColumns = () => {
        setUserColumns([]);
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
                    disabled={userColumns.length === 0}
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
    );
}

export default PerfColumnPicker;
