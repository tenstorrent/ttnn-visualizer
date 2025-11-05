// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React from 'react';
import classNames from 'classnames';
import { Icon, IconName, Intent, TagProps } from '@blueprintjs/core';
import HighlightedText from './HighlightedText';
import '../scss/components/ListItem.scss';
import MemoryTag from './MemoryTag';

interface ListItemProps {
    filterName: string;
    filterQuery: string;
    icon: IconName;
    iconColour?: keyof typeof ICON_COLOURS;
    intent?: Intent;
    tags?: TagProps[];
    children?: React.ReactNode;
}

const ICON_COLOURS = {
    none: '',
    operation: 'operation-icon',
    tensor: 'tensor-icon',
    error: 'error-icon',
};

const ListItem: React.FC<ListItemProps> = ({
    filterName,
    filterQuery,
    icon,
    iconColour = 'none',
    intent = Intent.NONE,
    tags,
    children,
}) => {
    return (
        <div className={classNames(ICON_COLOURS[iconColour], 'list-item')}>
            <Icon
                size={20}
                icon={icon}
                intent={intent}
                className='styled-icon'
            />

            <HighlightedText
                text={filterName}
                filter={filterQuery}
            />

            {children}

            {tags?.map((tag, index) => (
                <MemoryTag
                    memory={tag.htmlTitle}
                    key={index}
                />
            ))}
        </div>
    );
};

export default ListItem;
