// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import classNames from 'classnames';
import React from 'react';

interface HighlightedTextProps {
    text: string;
    filter: string;
    className?: string;
}

const HighlightedText: React.FC<HighlightedTextProps> = ({ text, filter, className }) => {
    const index = text.toLowerCase().indexOf(filter.toLowerCase());

    if (index === -1) {
        return (
            <span
                title={text}
                className={classNames('highlighted-text', className)}
            >
                {text}
            </span>
        );
    }

    const before = text.substring(0, index);
    const match = text.substring(index, index + filter.length);
    const after = text.substring(index + filter.length);

    return (
        <span
            title={text}
            className={classNames('highlighted-text', className)}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: `${before}<mark>${match}</mark>${after}` }}
        />
    );
};

export default HighlightedText;
