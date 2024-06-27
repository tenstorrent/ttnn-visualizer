// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import React from 'react';
import { Button, Icon, InputGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/SearchField.scss';

interface SearchFieldProps {
    searchQuery: string;
    onQueryChanged: (query: string) => void;
    controls?: React.ReactElement[];
    placeholder?: string;
    disabled?: boolean;
}

/**
 * Renders a search field. Controlled component.
 */
function SearchField({
    searchQuery,
    onQueryChanged,
    controls,
    disabled = false,
    placeholder = '',
}: SearchFieldProps): React.ReactElement {
    return (
        <div className='search-field'>
            <InputGroup
                disabled={disabled}
                rightElement={
                    searchQuery ? (
                        <Button
                            disabled={disabled}
                            minimal
                            onClick={() => {
                                onQueryChanged('');
                            }}
                            icon={IconNames.CROSS}
                        />
                    ) : (
                        <Icon icon={IconNames.SEARCH} />
                    )
                }
                placeholder={placeholder}
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => onQueryChanged(e.target.value)}
            />
            {controls}
        </div>
    );
}

export default SearchField;
