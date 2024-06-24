// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { type ReactElement } from 'react';

import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

interface FolderPickerProps {
    disabled?: boolean;
    text?: string | ReactElement;
    onSelectFolder: () => void;
}

const FolderPicker = ({ disabled = false, onSelectFolder, text }: FolderPickerProps): React.ReactElement => {
    return (
        <Button
            className={!text ? 'no-text' : ''}
            disabled={disabled}
            icon={IconNames.FOLDER_SHARED}
            onClick={onSelectFolder}
        >
            <span className='path-label'>{text ?? 'Select local folder'}</span>
        </Button>
    );
};

export default FolderPicker;
