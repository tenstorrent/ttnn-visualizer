// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useState } from 'react';

import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import RemoteConnectionDialog from './RemoteConnectionDialog';
import { RemoteConnection } from '../../definitions/RemoteConnection';

interface AddRemoteConnectionProps {
    disabled: boolean;
    onAddConnection: (remoteConnection: RemoteConnection) => void;
}

const AddRemoteConnection: FC<AddRemoteConnectionProps> = ({ disabled, onAddConnection }) => {
    const [isAddConnectionDialogOpen, setIsAddConnectionDialogOpen] = useState(false);

    return (
        <div className='buttons-container'>
            <Button
                icon={IconNames.PLUS}
                text='Add new connection'
                disabled={disabled}
                onClick={() => setIsAddConnectionDialogOpen(true)}
            />

            <RemoteConnectionDialog
                open={isAddConnectionDialogOpen}
                onAddConnection={(newConnection) => {
                    onAddConnection(newConnection);
                    setIsAddConnectionDialogOpen(false);
                }}
                onClose={() => setIsAddConnectionDialogOpen(false)}
            />
        </div>
    );
};

export default AddRemoteConnection;
