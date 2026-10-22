// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { KeyboardEvent } from 'react';
import { Button, ButtonVariant } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { TEST_IDS } from '../../definitions/TestIds';

export const LINKED_ONLY_LABEL = 'Show linked reports only';
export const NO_LINKED_RESULTS_TEXT = 'No linked reports.';
// Blueprint's own wording for the clear button these actions replace.
const CLEAR_QUERY_LABEL = 'Clear filter query';

// The picker's QueryList selects the active row on an Enter that reaches its popover content,
// from any focused element in it. Pressing Enter on one of these buttons must only press it;
// Button runs these handlers after its own Enter-to-click handling, so the click still happens.
const stopEnterPropagation = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Enter') {
        event.stopPropagation();
    }
};

interface FolderPickerFilterActionsProps {
    query: string;
    onClearQuery: () => void;
    showLinkedOnlyToggle: boolean;
    isLinkedOnly: boolean;
    onToggleLinkedOnly: () => void;
}

/**
 * Right-hand buttons of a folder picker's filter input. Supplying them replaces Blueprint's
 * clear button, so the clear button is rendered here too.
 */
const FolderPickerFilterActions = ({
    query,
    onClearQuery,
    showLinkedOnlyToggle,
    isLinkedOnly,
    onToggleLinkedOnly,
}: FolderPickerFilterActionsProps) => {
    if (!showLinkedOnlyToggle && !query) {
        return null;
    }

    return (
        <div className='folder-picker-filter-actions'>
            {showLinkedOnlyToggle && (
                <Button
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.LINK}
                    active={isLinkedOnly}
                    aria-pressed={isLinkedOnly}
                    aria-label={LINKED_ONLY_LABEL}
                    title={LINKED_ONLY_LABEL}
                    data-testid={TEST_IDS.FOLDER_PICKER_LINKED_ONLY_TOGGLE}
                    onClick={onToggleLinkedOnly}
                    onKeyDown={stopEnterPropagation}
                    onKeyUp={stopEnterPropagation}
                />
            )}
            {query && (
                <Button
                    variant={ButtonVariant.MINIMAL}
                    icon={IconNames.CROSS}
                    aria-label={CLEAR_QUERY_LABEL}
                    title={CLEAR_QUERY_LABEL}
                    onClick={onClearQuery}
                    onKeyDown={stopEnterPropagation}
                    onKeyUp={stopEnterPropagation}
                />
            )}
        </div>
    );
};

export default FolderPickerFilterActions;
