// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useRef, useState } from 'react';
import { SelectProps } from '@blueprintjs/select';
import FolderPickerFilterActions from '../components/report-selection/FolderPickerFilterActions';

// The props are the same for every item type, so `unknown` keeps them spreadable into any Select.
export type FolderPickerFilterSelectProps = Required<
    Pick<SelectProps<unknown>, 'query' | 'onQueryChange' | 'inputProps'>
>;

interface FolderPickerFilter {
    /** Whether the linked-only filter applies; feed it to the picker's item predicate. */
    isLinkedOnlyActive: boolean;
    /** Spread into the picker's `Select`: a controlled query plus the filter input's buttons. */
    selectProps: FolderPickerFilterSelectProps;
}

/**
 * Filter state for a report picker: the text query, the linked-only toggle, and the buttons in
 * the filter input. Supplying those buttons replaces Blueprint's clear button, which is why the
 * query is controlled here.
 */
const useFolderPickerFilter = (showLinkStatus: boolean): FolderPickerFilter => {
    const [query, setQuery] = useState('');
    const [isLinkedOnly, setIsLinkedOnly] = useState(false);
    const [prevShowLinkStatus, setPrevShowLinkStatus] = useState(showLinkStatus);
    const inputRef = useRef<HTMLInputElement>(null);

    // Turn the toggle off when the badges go, so it does not come back pressed against a report
    // the user never filtered on.
    if (showLinkStatus !== prevShowLinkStatus) {
        setPrevShowLinkStatus(showLinkStatus);
        if (!showLinkStatus) {
            setIsLinkedOnly(false);
        }
    }

    // The clear button unmounts once the query is empty, taking focus with it; without this the
    // popover's keyboard handling (arrows, Enter, typing) stops reaching the picker.
    const handleClearQuery = () => {
        setQuery('');
        inputRef.current?.focus();
    };

    const handleToggleLinkedOnly = () => setIsLinkedOnly((current) => !current);

    return {
        // Without badges there is nothing to filter on, so the toggle must not hide rows even on
        // the render that turns it off.
        isLinkedOnlyActive: showLinkStatus && isLinkedOnly,
        selectProps: {
            query,
            onQueryChange: setQuery,
            inputProps: {
                inputRef,
                rightElement: (
                    <FolderPickerFilterActions
                        query={query}
                        onClearQuery={handleClearQuery}
                        showLinkedOnlyToggle={showLinkStatus}
                        isLinkedOnly={isLinkedOnly}
                        onToggleLinkedOnly={handleToggleLinkedOnly}
                    />
                ),
            },
        },
    };
};

export default useFolderPickerFilter;
