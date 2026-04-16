// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { FC, useState } from 'react';
import { Button, MenuItem, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRendererProps, Select } from '@blueprintjs/select';
import RemoteConnectionDialog from './RemoteConnectionDialog';
import { RemoteConnection } from '../../definitions/RemoteConnection';
import { isEqual } from '../../functions/math';
import HighlightedText from '../HighlightedText';

interface RemoteConnectionSelectorProps {
    connectionList: RemoteConnection[];
    connection?: RemoteConnection;
    disabled: boolean;
    loading: boolean;
    onSelectConnection: (connection: RemoteConnection) => void;
    onEditConnection: (updatedConnection: RemoteConnection, currentConnection?: RemoteConnection) => void;
    onRemoveConnection: (connection: RemoteConnection) => void;
    onSyncRemoteFolderList: (connection: RemoteConnection) => void;
}

const EDIT_CONNECTION_LABEL = 'Edit selected connection';
const REMOVE_CONNECTION_LABEL = 'Remove selected connection';

const RemoteConnectionSelector: FC<RemoteConnectionSelectorProps> = ({
    connectionList,
    connection,
    disabled,
    loading,
    onSelectConnection,
    onEditConnection,
    onRemoveConnection,
    onSyncRemoteFolderList,
}) => {
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const selectedConnection = connection ?? connectionList[0];

    return (
        <>
            <div className='form-container'>
                <Select
                    className='remote-select'
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
                        icon={IconNames.CLOUD}
                        endIcon={IconNames.CARET_DOWN}
                        disabled={disabled}
                        text={formatConnectionString(selectedConnection)}
                    />
                </Select>
                <Tooltip
                    content={EDIT_CONNECTION_LABEL}
                    position={PopoverPosition.TOP}
                >
                    <Button
                        aria-label={EDIT_CONNECTION_LABEL}
                        icon={IconNames.EDIT}
                        disabled={disabled || !selectedConnection}
                        onClick={() => setIsEditDialogOpen(true)}
                    />
                </Tooltip>
                <Tooltip
                    content={REMOVE_CONNECTION_LABEL}
                    position={PopoverPosition.TOP}
                >
                    <Button
                        aria-label={REMOVE_CONNECTION_LABEL}
                        icon={IconNames.TRASH}
                        disabled={disabled || !selectedConnection}
                        onClick={() => onRemoveConnection(selectedConnection)}
                    />
                </Tooltip>

                <RemoteConnectionDialog
                    key={`${selectedConnection?.name}${selectedConnection?.host}${selectedConnection?.port}${selectedConnection?.profilerPath}`}
                    open={isEditDialogOpen}
                    onAddConnection={(updatedConnection) => {
                        onEditConnection(updatedConnection, connection);
                    }}
                    onClose={() => setIsEditDialogOpen(false)}
                    onSave={(updatedConnection) => {
                        onEditConnection(updatedConnection, connection);
                        onSyncRemoteFolderList(updatedConnection);
                    }}
                    title='Edit remote connection'
                    buttonLabel='Save connection'
                    remoteConnection={selectedConnection}
                />
            </div>

            <Tooltip
                content='Fetching remote folders list...'
                position={PopoverPosition.TOP}
                disabled={!loading}
            >
                <Button
                    icon={IconNames.REFRESH}
                    disabled={disabled || !selectedConnection}
                    loading={loading}
                    text='Fetch remote folders list'
                    onClick={() => onSyncRemoteFolderList(selectedConnection)}
                />
            </Tooltip>
        </>
    );
};

const formatConnectionString = (connection?: RemoteConnection) => {
    if (!connection) {
        return '(No connection)';
    }

    return `${connection.name} - ssh://${connection.host}:${connection.port}/${connection?.profilerPath?.replace(/^\//gi, '')}`;
};

const filterRemoteConnections = (query: string, connection: RemoteConnection) => {
    return formatConnectionString(connection).toLowerCase().includes(query.toLowerCase());
};

type RenderRemoteConnectionProps<T> = (
    item: T,
    itemProps: ItemRendererProps,
    selectedItem: T,
) => React.JSX.Element | null;

const renderRemoteConnection: RenderRemoteConnectionProps<RemoteConnection> = (
    connection,
    { handleClick, modifiers, query },
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
            text={
                <HighlightedText
                    text={formatConnectionString(connection)}
                    filter={query}
                />
            }
        />
    );
};

export default RemoteConnectionSelector;
