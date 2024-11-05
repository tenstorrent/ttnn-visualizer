// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import React, { FC, useState } from 'react';
import { AnchorButton, Button, MenuItem, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRendererProps, Select } from '@blueprintjs/select';
import RemoteConnectionDialog from './RemoteConnectionDialog';
import { RemoteConnection } from '../../definitions/RemoteConnection';
import { isEqual } from '../../functions/math';

const formatConnectionString = (connection?: RemoteConnection) => {
    if (!connection) {
        return '(No connection)';
    }

    return `${connection.name} - ssh://${connection.host}:${connection.port}/${connection.path.replace(/^\//gi, '')}`;
};

const filterRemoteConnections = (query: string, connection: RemoteConnection) => {
    return formatConnectionString(connection).toLowerCase().includes(query.toLowerCase());
};

interface RemoteConnectionSelectorProps {
    connectionList: RemoteConnection[];
    connection?: RemoteConnection;
    disabled: boolean;
    loading: boolean;
    offline: boolean;
    onSelectConnection: (connection: RemoteConnection) => void;
    onEditConnection: (updatedConnection: RemoteConnection, currentConnection?: RemoteConnection) => void;
    onRemoveConnection: (connection: RemoteConnection) => void;
    onSyncRemoteFolderList: (connection: RemoteConnection) => void;
}

const RemoteConnectionSelector: FC<RemoteConnectionSelectorProps> = ({
    connectionList,
    connection,
    disabled,
    loading,
    offline,
    onSelectConnection,
    onEditConnection,
    onRemoveConnection,
    onSyncRemoteFolderList,
}) => {
    const [isEditdialogOpen, setIsEditDialogOpen] = useState(false);
    const selectedConnection = connection ?? connectionList[0];

    return (
        <div className='buttons-container'>
            <Select
                className='remote-connection-select'
                items={connectionList}
                itemRenderer={(item, itemProps) => renderRemoteConnection(item, itemProps, selectedConnection)}
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
                onClick={() => onSyncRemoteFolderList(selectedConnection)}
            />
        </div>
    );
};

type RenderRemoteConnectionProps<T> = (
    item: T,
    itemProps: ItemRendererProps,
    selectedItem: T,
) => React.JSX.Element | null;

const renderRemoteConnection: RenderRemoteConnectionProps<RemoteConnection> = (
    connection,
    { handleClick, modifiers },
    selectedConnection,
) => {
    if (!modifiers.matchesPredicate) {
        return null;
    }

    return (
        <MenuItem
            active={isEqual(connection, selectedConnection)}
            disabled={modifiers.disabled}
            key={formatConnectionString(connection)}
            onClick={handleClick}
            text={formatConnectionString(connection)}
        />
    );
};

export default RemoteConnectionSelector;
