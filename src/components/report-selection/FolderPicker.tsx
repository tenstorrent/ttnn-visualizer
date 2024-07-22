// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React from 'react';

import { FileInput } from '@blueprintjs/core';
import 'styles/components/FolderPicker.scss';

interface FolderPickerProps {
    text?: string;
    onSelectFolder: (arg: string) => void;
}

const FolderPicker = ({ text, onSelectFolder }: FolderPickerProps): React.ReactElement => {
    return (
        <FileInput
            text={text}
            onInputChange={(event) => onSelectFolder(event.currentTarget.value)}
            fill={false}
        />
    );
};

export default FolderPicker;
