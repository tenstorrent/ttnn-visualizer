// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, Icon, Intent, MenuItem, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { useState } from 'react';
import RemoteConnectionDialog from './RemoteConnectionDialog';
import { FETCH_REMOTE_FOLDERS_LABEL } from '../../definitions/RemoteConnection';
import { RemoteConnection } from '../../model/RemoteConnection';
import { ManagedEntity } from '../../definitions/ManagedEntity';
import { TEST_IDS } from '../../definitions/TestIds';
import { isSameConnection, remoteConnectionKey } from '../../functions/remoteConnection';
import { getRemoteConnectionPathError } from '../../functions/remotePath';
import ConfirmDeleteAlert from '../ConfirmDeleteAlert';
import HighlightedText from '../HighlightedText';
import SelectRowActions from './SelectRowActions';
import 'styles/components/RemoteConnectionSelector.scss';

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

const RemoteConnectionSelector = ({
    connectionList,
    connection,
    disabled,
    loading,
    onSelectConnection,
    onEditConnection,
    onRemoveConnection,
    onSyncRemoteFolderList,
}: RemoteConnectionSelectorProps) => {
    const [connectionToEdit, setConnectionToEdit] = useState<RemoteConnection | null>(null);
    const [connectionToDelete, setConnectionToDelete] = useState<RemoteConnection | null>(null);
    const selectedConnection = connection ?? connectionList[0];
    // A connection saved before report paths were validated is kept in the list rather
    // than hidden, so the only route back is editing it — which means the row has to say
    // what is wrong and the fetch it would fail at has to be closed off.
    const selectedConnectionPathError = selectedConnection ? getRemoteConnectionPathError(selectedConnection) : null;

    const renderRemoteConnection: ItemRenderer<RemoteConnection> = (item, { handleClick, modifiers, query }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        const pathError = getRemoteConnectionPathError(item);

        return (
            // Presentational for the same reason as the other selectors: MenuItem owns the
            // <li role="option">, so this wrapper must not sit between it and the listbox.
            <div
                className='remote-connection-menu-item'
                role='none'
                data-testid={TEST_IDS.REMOTE_CONNECTION_ROW}
                key={remoteConnectionKey(item)}
            >
                <MenuItem
                    active={isSameConnection(item, selectedConnection)}
                    disabled={modifiers.disabled}
                    onClick={handleClick}
                    roleStructure='listoption'
                    text={
                        <HighlightedText
                            text={formatConnectionString(item)}
                            filter={query}
                        />
                    }
                />

                {pathError && (
                    <Tooltip
                        content={`${pathError} Edit this connection to fix it.`}
                        position={PopoverPosition.TOP}
                    >
                        <Icon
                            icon={IconNames.WARNING_SIGN}
                            intent={Intent.WARNING}
                            data-testid={TEST_IDS.REMOTE_CONNECTION_PATH_WARNING}
                            aria-label={`${item.name} has an unusable report path`}
                        />
                    </Tooltip>
                )}

                <SelectRowActions
                    entity={ManagedEntity.REMOTE_CONNECTION}
                    itemName={item.name}
                    disabled={disabled}
                    onEdit={() => setConnectionToEdit(item)}
                    onDelete={() => setConnectionToDelete(item)}
                />
            </div>
        );
    };

    return (
        <div className='remote-connection-selector'>
            <div className='form-container'>
                <Select<RemoteConnection>
                    className='remote-select'
                    items={connectionList}
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
                        icon={IconNames.CLOUD}
                        endIcon={IconNames.CARET_DOWN}
                        disabled={disabled}
                        text={formatConnectionString(selectedConnection)}
                    />
                </Select>
            </div>

            <Tooltip
                content={selectedConnectionPathError ?? 'Fetching remote folders...'}
                position={PopoverPosition.TOP}
                disabled={!loading && !selectedConnectionPathError}
            >
                <Button
                    icon={IconNames.REFRESH}
                    disabled={disabled || !selectedConnection || selectedConnectionPathError !== null}
                    loading={loading}
                    text={FETCH_REMOTE_FOLDERS_LABEL}
                    onClick={() => onSyncRemoteFolderList(selectedConnection)}
                />
            </Tooltip>

            {connectionToEdit && (
                <RemoteConnectionDialog
                    key={remoteConnectionKey(connectionToEdit)}
                    open
                    existingConnections={connectionList}
                    // The dialog always calls onAddConnection and then onSave, so the edit is applied
                    // here and only the follow-up fetch belongs in onSave.
                    onAddConnection={(updatedConnection) => onEditConnection(updatedConnection, connectionToEdit)}
                    onClose={() => setConnectionToEdit(null)}
                    onSave={(updatedConnection) => {
                        // Fetching populates the folder lists for whichever connection is in use, so
                        // editing a connection that isn't selected must not trigger it.
                        if (isSameConnection(connectionToEdit, selectedConnection)) {
                            onSyncRemoteFolderList(updatedConnection);
                        }
                    }}
                    title='Edit remote connection'
                    buttonLabel='Save connection'
                    remoteConnection={connectionToEdit}
                />
            )}

            {connectionToDelete && (
                <ConfirmDeleteAlert
                    isOpen
                    entity={ManagedEntity.REMOTE_CONNECTION}
                    entityName={connectionToDelete.name}
                    onCancel={() => setConnectionToDelete(null)}
                    onConfirm={() => {
                        onRemoveConnection(connectionToDelete);
                        setConnectionToDelete(null);
                    }}
                >
                    <p>Its cached memory and performance report lists will be cleared too.</p>
                </ConfirmDeleteAlert>
            )}
        </div>
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

export default RemoteConnectionSelector;
