// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FormGroup } from '@blueprintjs/core';
import { type FC, useState } from 'react';
import { useNavigate } from 'react-router';
import FolderPicker from './FolderPicker';

import 'styles/components/FolderPicker.scss';

const DEFAULT_TEXT = 'Choose report...';

const LocalFolderOptions: FC = () => {
    const [localFolderPath, setLocalFolderPath] = useState(DEFAULT_TEXT);

    const navigate = useNavigate();

    const handleFolderSelect = (value: string) => {
        setLocalFolderPath(value);

        navigate('/operations');
    };

    return (
        <FormGroup
            label={<h3>Select local report</h3>}
            labelFor='text-input'
            subLabel='Select a local directory containing a report'
        >
            <div className='buttons-container'>
                <FolderPicker onSelectFolder={(value) => handleFolderSelect(value)} text={localFolderPath} />
            </div>
        </FormGroup>
    );
};

export default LocalFolderOptions;
