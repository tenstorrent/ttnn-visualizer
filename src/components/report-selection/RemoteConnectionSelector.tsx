// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { AnchorButton, Button, MenuItem, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { FC, useState } from 'react';
import RemoteConnectionDialog from './RemoteConnectionDialog';
import { Connection } from '../../model/Connection';

const formatConnectionString = (connection?: Connection) => {
    if (!connection) {
        return '(No connection)';
    }

    return `${connection.name} - ssh://${connection.host}:${connection.port}/${connection.path.replace(/^\//gi, '')}`;
};

const filterRemoteConnections = (query: string, connection: Connection) => {
    return formatConnectionString(connection).toLowerCase().includes(query.toLowerCase());
};

const renderRemoteConnection: ItemRenderer<Connection> = (connection, { handleClick, modifiers }) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    return (
        <MenuItem
            active={modifiers.active}
            disabled={modifiers.disabled}
            key={formatConnectionString(connection)}
            onClick={handleClick}
            text={formatConnectionString(connection)}
        />
    );
};

interface RemoteConnectionSelectorProps {
    connections: Connection[];
    connection?: Connection;
    disabled: boolean;
    loading: boolean;
    offline: boolean;
    onSelectConnection: (connection: Connection) => void;
    onEditConnection: (newConnection: Connection, oldConnection?: Connection) => void;
    onRemoveConnection: (connection: Connection) => void;
    onSyncRemoteFolders: (connection: Connection) => void;
}

const RemoteConnectionSelector: FC<RemoteConnectionSelectorProps> = ({
    connections,
    connection,
    disabled,
    loading,
    offline,
    onSelectConnection,
    onEditConnection,
    onRemoveConnection,
    onSyncRemoteFolders,
}) => {
    const [isEditdialogOpen, setIsEditDialogOpen] = useState(false);
    const selectedConnection = connection ?? connections[0];

    return (
        <div className='buttons-container'>
            <Select
                className='remote-connection-select'
                items={connections}
                itemRenderer={renderRemoteConnection}
                disabled={disabled}
                filterable
                itemPredicate={filterRemoteConnections}
                noResults={
                    <MenuItem
                        disabled
                        text='No results'
                        roleStructure='listoption'
                    />
                }
                onItemSelect={onSelectConnection}
            >
                <Button
                    icon={offline ? IconNames.BAN_CIRCLE : IconNames.CLOUD}
                    rightIcon={IconNames.CARET_DOWN}
                    disabled={disabled}
                    text={formatConnectionString(selectedConnection)}
                />
            </Select>
            <Tooltip content='Edit selected connection'>
                <AnchorButton
                    icon={IconNames.EDIT}
                    disabled={disabled || !selectedConnection}
                    onClick={() => setIsEditDialogOpen(true)}
                />
            </Tooltip>
            <Tooltip content='Remove selected connection'>
                <AnchorButton
                    icon={IconNames.TRASH}
                    disabled={disabled || !selectedConnection}
                    onClick={() => onRemoveConnection(selectedConnection)}
                />
            </Tooltip>

            <RemoteConnectionDialog
                key={`${selectedConnection?.name}${selectedConnection?.host}${selectedConnection?.port}${selectedConnection?.path}`}
                open={isEditdialogOpen}
                onAddConnection={(updatedConnection) => {
                    setIsEditDialogOpen(false);
                    onEditConnection(updatedConnection, connection);
                }}
                onClose={() => {
                    setIsEditDialogOpen(false);
                }}
                title='Edit remote connection'
                buttonLabel='Save connection'
                remoteConnection={selectedConnection}
            />
            <Button
                icon={IconNames.LOCATE}
                disabled={disabled || !selectedConnection}
                loading={loading}
                text='Fetch remote folders list'
                onClick={() => onSyncRemoteFolders(selectedConnection)}
            />
        </div>
    );
};

export default RemoteConnectionSelector;
