// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, ButtonVariant, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ManagedEntity } from '../../definitions/ManagedEntity';
import { getDeleteActionLabel, getEditActionLabel } from '../../functions/managedEntityLabels';

interface SelectRowActionsProps {
    entity: ManagedEntity;
    /** Names the row in each action's accessible label. */
    itemName: string;
    disabled: boolean;
    /** Omit on rows that can only be deleted. */
    onEdit?: () => void;
    onDelete: () => void;
}

/**
 * The trailing actions on a report-selection dropdown row. Shared so the three selectors present
 * one interaction model — the divergence this replaced is what #1823 was raised for.
 */
const SelectRowActions = ({ entity, itemName, disabled, onEdit, onDelete }: SelectRowActionsProps) => (
    <>
        {onEdit && (
            <Button
                aria-label={getEditActionLabel(entity, itemName)}
                icon={IconNames.EDIT}
                disabled={disabled}
                variant={ButtonVariant.MINIMAL}
                onClick={onEdit}
            />
        )}

        <Button
            aria-label={getDeleteActionLabel(entity, itemName)}
            icon={IconNames.TRASH}
            disabled={disabled}
            variant={ButtonVariant.MINIMAL}
            intent={Intent.DANGER}
            onClick={onDelete}
        />
    </>
);

export default SelectRowActions;
