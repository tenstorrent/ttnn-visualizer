// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC } from 'react';

import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

interface AddRemoteConnectionProps {
    disabled: boolean;
}

const AddRemoteConnection: FC<AddRemoteConnectionProps> = ({ disabled }) => {
    return (
        <div className='buttons-container'>
            <Button icon={IconNames.PLUS} text='Add new connection' disabled={disabled} onClick={() => {}} />
        </div>
    );
};

export default AddRemoteConnection;
