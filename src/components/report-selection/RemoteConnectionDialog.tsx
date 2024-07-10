// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, Dialog, DialogBody, DialogFooter, FormGroup, Icon, IconName, InputGroup } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { FC, useState } from 'react';

import useRemoteConnection, { ConnectionStatus, ConnectionTestStates, RemoteConnection } from '../../hooks/useRemote';

import 'styles/components/RemoteConnectionDialog.scss';

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
            <Icon
                className='connection-status-icon'
                icon={icon}
                size={20}
            />
            <span className='connection-status-text'>{message}</span>
        </div>
    );
};

interface RemoteFolderDialogProps {
    title?: string;
    buttonLabel?: string;
    open: boolean;
    onClose: () => void;
    onAddConnection: (connection: RemoteConnection) => void;
    remoteConnection?: RemoteConnection;
}

const RemoteFolderDialog: FC<RemoteFolderDialogProps> = ({
    open,
    onClose,
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
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>(defaultConnectionTests);
    const { testConnection, testRemoteFolder } = useRemoteConnection();
    const [isTestingConnection, setIsTestingconnection] = useState(false);
    // const logging = useLogging();

    const isValidConnection = connectionTests.every((status) => status.status === ConnectionTestStates.OK);

    const testConnectionStatus = async () => {
        setIsTestingconnection(true);

        const sshProgressStatus = { status: ConnectionTestStates.PROGRESS, message: 'Testing connection' };
        const folderProgressStatus = { status: ConnectionTestStates.PROGRESS, message: 'Testing remote folder path' };

        setConnectionTests([sshProgressStatus, folderProgressStatus]);

        try {
            const sshStatus = await testConnection(connection);
            let folderStatus = folderProgressStatus;

            if (sshStatus.status === ConnectionTestStates.FAILED) {
                folderStatus = { status: ConnectionTestStates.FAILED, message: 'Could not connect to SSH server' };
            }

            setConnectionTests([sshStatus, folderStatus]);

            if (sshStatus.status === ConnectionTestStates.OK) {
                folderStatus = await testRemoteFolder(connection);

                setConnectionTests([sshStatus, folderStatus]);
            }
        } catch (err) {
            // logging.error((err as Error)?.message ?? err?.toString() ?? 'Unknown error');

            setConnectionTests([
                { status: ConnectionTestStates.FAILED, message: 'Connection failed' },
                { status: ConnectionTestStates.FAILED, message: 'Remote folder path failed' },
            ]);
        } finally {
            setIsTestingconnection(false);
        }
    };

    const closeDialog = () => {
        setConnection(defaultConnection);
        setConnectionTests(defaultConnectionTests);
        onClose();
    };

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
                <FormGroup
                    label='Name'
                    labelFor='text-input'
                    subLabel='Connection name'
                >
                    <InputGroup
                        className='bp4-light'
                        key='name'
                        value={connection.name}
                        onChange={(e) => setConnection({ ...connection, name: e.target.value })}
                    />
                </FormGroup>
                <FormGroup
                    label='SSH Host'
                    labelFor='text-input'
                    subLabel='SSH host name. E.g.: localhost'
                >
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

                    <ConnectionTestMessage
                        status={connectionTests[0].status}
                        message={connectionTests[0].message}
                    />
                    <ConnectionTestMessage
                        status={connectionTests[1].status}
                        message={connectionTests[1].message}
                    />

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

RemoteFolderDialog.defaultProps = {
    title: 'Add new remote connection',
    buttonLabel: 'Add connection',
    remoteConnection: undefined,
};

export default RemoteFolderDialog;
