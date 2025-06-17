// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import { Button, Icon, InputGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import 'styles/components/SearchField.scss';
import classNames from 'classnames';

interface SearchFieldProps {
    searchQuery: string;
    onQueryChanged: (query: string) => void;
    controls?: React.ReactElement[];
    placeholder?: string;
    disabled?: boolean;
    className?: string;
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
    className,
}: SearchFieldProps): React.ReactElement {
    return (
        <div className={classNames(className, 'search-field')}>
            <InputGroup
                disabled={disabled}
                rightElement={
                    searchQuery ? (
                        <Button
                            disabled={disabled}
                            variant='minimal'
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
