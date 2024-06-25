// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FormGroup } from '@blueprintjs/core';
import { type FC } from 'react';
import { useNavigate } from 'react-router';
import FolderPicker from './FolderPicker';

import 'styles/components/FolderPicker.scss';

const LocalFolderOptions: FC = () => {
    const navigate = useNavigate();

    return (
        <FormGroup
            label={<h3>Select local report</h3>}
            labelFor='text-input'
            subLabel='Select a local directory containing a report'
        >
            <div className='buttons-container'>
                <FolderPicker onSelectFolder={() => navigate('/operations')} />
            </div>
        </FormGroup>
    );
};

export default LocalFolderOptions;
