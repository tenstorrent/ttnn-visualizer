// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from 'react';

import { Button } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';

import RemoteConnectionDialog from './RemoteConnectionDialog';
import { RemoteConnection } from '../../model/RemoteConnection';

interface AddRemoteConnectionProps {
    disabled: boolean;
    connectionList: RemoteConnection[];
    onAddConnection: (remoteConnection: RemoteConnection) => void;
}

const AddRemoteConnection = ({ disabled, connectionList, onAddConnection }: AddRemoteConnectionProps) => {
    const [isAddConnectionDialogOpen, setIsAddConnectionDialogOpen] = useState(false);

    return (
        <div className='form-container'>
            <Button
                icon={IconNames.PLUS}
                text='Add new connection'
                disabled={disabled}
                onClick={() => setIsAddConnectionDialogOpen(true)}
            />

            <RemoteConnectionDialog
                open={isAddConnectionDialogOpen}
                existingConnections={connectionList}
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
