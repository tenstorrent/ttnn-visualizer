// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Dialog, DialogBody, DialogFooter, FormGroup, Icon, IconName, InputGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { FC, useState } from 'react';
import 'styles/components/RemoteConnectionDialog.scss';

interface RemoteConnection {
    name: string;
    host: string;
    port: number;
    path: string;
}

enum ConnectionTestStates {
    IDLE,
    PROGRESS,
    FAILED,
    OK,
}

interface ConnectionStatus {
    status: ConnectionTestStates;
    message: string;
}

const ConnectionTestMessage: FC<ConnectionStatus> = ({ status, message }) => {
    const iconMap: Record<ConnectionTestStates, IconName> = {
        [ConnectionTestStates.IDLE]: IconNames.DOT,
        [ConnectionTestStates.PROGRESS]: IconNames.DOT,
        [ConnectionTestStates.FAILED]: IconNames.CROSS,
        [ConnectionTestStates.OK]: IconNames.TICK,
    };
    const icon = iconMap[status];

    return (
        <div className={`verify-connection-item status-${ConnectionTestStates[status]}`}>
            <Icon className='connection-status-icon' icon={icon} size={20} />
            <span className='connection-status-text'>{message}</span>
        </div>
    );
};

interface RemoteFolderDialogProps {
    title?: string;
    buttonLabel?: string;
    open: boolean;
    onAddConnection: (connection: RemoteConnection) => void;
    remoteConnection?: RemoteConnection;
}

const RemoteFolderDialog: FC<RemoteFolderDialogProps> = ({
    open,
    onAddConnection,
    title = 'Add new remote connection',
    buttonLabel = 'Add connection',
    remoteConnection,
}) => {
    const defaultConnection = remoteConnection ?? { name: '', host: '', port: 22, path: '' };
    const defaultConnectionTests: ConnectionStatus[] = [
        { status: ConnectionTestStates.IDLE, message: 'Test connection' },
        { status: ConnectionTestStates.IDLE, message: 'Test remote folder path' },
    ];
    const [connection, setConnection] = useState<Partial<RemoteConnection>>(defaultConnection);
    const [connectionTests, _setConnectionTests] = useState<ConnectionStatus[]>(defaultConnectionTests);
    const [isTestingConnection, _setIsTestingconnection] = useState(false);

    const isValidConnection = connectionTests.every((status) => status.status === ConnectionTestStates.OK);

    const testConnectionStatus = async () => {};

    const closeDialog = () => {};

    return (
        <Dialog
            className='remote-connection-dialog'
            title={title}
            icon='info-sign'
            canOutsideClickClose={false}
            isOpen={open}
            onClose={closeDialog}
        >
            <DialogBody>
                <FormGroup label='Name' labelFor='text-input' subLabel='Connection name'>
                    <InputGroup
                        className='bp5-light'
                        key='name'
                        value={connection.name}
                        onChange={(e) => setConnection({ ...connection, name: e.target.value })}
                    />
                </FormGroup>
                <FormGroup label='SSH Host' labelFor='text-input' subLabel='SSH host name. E.g.: localhost'>
                    <InputGroup
                        key='host'
                        value={connection.host}
                        onChange={(e) => setConnection({ ...connection, host: e.target.value })}
                    />
                </FormGroup>
                <FormGroup
                    label='SSH Port'
                    labelFor='text-input'
                    subLabel='Port to use for the SSH connection. E.g.: port 22'
                >
                    <InputGroup
                        key='port'
                        value={connection.port?.toString() ?? ''}
                        onChange={(e) => {
                            const number = Number.parseInt(e.target.value, 10);

                            if (e.target.value === '') {
                                setConnection({ ...connection, port: undefined });
                            } else if (number > 0 && number < 99999) {
                                setConnection({ ...connection, port: number });
                            }
                        }}
                    />
                </FormGroup>
                <FormGroup
                    label='Remote Folder path'
                    labelFor='text-input'
                    subLabel='Path to the remote folder. E.g.: "$HOME/work/ll-sw"'
                >
                    <InputGroup
                        key='path'
                        value={connection.path}
                        onChange={(e) => setConnection({ ...connection, path: e.target.value })}
                    />
                </FormGroup>
                <fieldset>
                    <legend>Test Connection</legend>

                    <ConnectionTestMessage status={connectionTests[0].status} message={connectionTests[0].message} />
                    <ConnectionTestMessage status={connectionTests[1].status} message={connectionTests[1].message} />

                    <br />
                    <Button
                        text='Test Connection'
                        disabled={isTestingConnection}
                        loading={isTestingConnection}
                        onClick={testConnectionStatus}
                    />
                </fieldset>
            </DialogBody>
            <DialogFooter
                minimal
                actions={
                    <Button
                        text={buttonLabel}
                        disabled={!isValidConnection}
                        onClick={() => {
                            if (isValidConnection) {
                                onAddConnection(connection as RemoteConnection);
                                closeDialog();
                            }
                        }}
                    />
                }
            />
        </Dialog>
    );
};

export default RemoteFolderDialog;
