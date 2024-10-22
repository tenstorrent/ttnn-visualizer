// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import {
    Button,
    ButtonGroup,
    Checkbox,
    Dialog,
    DialogBody,
    DialogFooter,
    FormGroup,
    InputGroup,
} from '@blueprintjs/core';
import { FC, useState } from 'react';
import 'styles/components/RemoteConnectionDialog.scss';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { RemoteConnection } from '../../definitions/RemoteConnection';
import useRemoteConnection from '../../hooks/useRemote';
import ConnectionTestMessage from './ConnectionTestMessage';

interface RemoteConnectionDialogProps {
    title?: string;
    buttonLabel?: string;
    open: boolean;
    onClose: () => void;
    onAddConnection: (connection: RemoteConnection) => void;
    remoteConnection?: RemoteConnection;
}

const RemoteConnectionDialog: FC<RemoteConnectionDialogProps> = ({
    open,
    onClose,
    onAddConnection,
    title = 'Add new remote connection',
    buttonLabel = 'Add connection',
    remoteConnection,
}) => {
    const defaultConnection = remoteConnection ?? { name: '', host: '', port: 22, path: '', username: '' };
    const defaultConnectionTests: ConnectionStatus[] = [
        { status: ConnectionTestStates.IDLE, message: 'Test connection' },
        { status: ConnectionTestStates.IDLE, message: 'Test remote folder path' },
    ];
    const [connection, setConnection] = useState<Partial<RemoteConnection>>(defaultConnection);
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>(defaultConnectionTests);
    const { testConnection, fetchSqlitePath } = useRemoteConnection();
    const [isTestingConnection, setIsTestingconnection] = useState(false);

    const isValidConnection = connectionTests.every((status) => status.status === ConnectionTestStates.OK);

    const getSqlitePath = async () => {
        setIsTestingconnection(true);
        const status = await fetchSqlitePath(connection);
        if (status.status === ConnectionTestStates.OK) {
            setConnection({ ...connection, sqliteBinaryPath: status.message });
        }
        setIsTestingconnection(false);
    };

    const testConnectionStatus = async () => {
        setIsTestingconnection(true);

        const sshProgressStatus = { status: ConnectionTestStates.PROGRESS, message: 'Testing connection' };
        const folderProgressStatus = { status: ConnectionTestStates.PROGRESS, message: 'Testing remote folder path' };

        setConnectionTests([sshProgressStatus, folderProgressStatus]);

        try {
            const statuses = await testConnection(connection);
            setConnectionTests(statuses);
        } catch (err) {
            // TODO: Look at error handling
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
                        className='bp5-light'
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
                    label='Username'
                    labelFor='text-input'
                    subLabel='Username to connect with'
                >
                    <InputGroup
                        key='username'
                        value={connection.username ?? ''}
                        onChange={(e) => {
                            setConnection({ ...connection, username: e.target.value });
                        }}
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

                <FormGroup>
                    <Checkbox
                        checked={connection.useRemoteQuerying}
                        label='Use Remote Querying'
                        onChange={(e) => setConnection({ ...connection, useRemoteQuerying: e.target.checked })}
                    />
                </FormGroup>
                {connection.useRemoteQuerying && (
                    <fieldset className='remote-querying-fieldset'>
                        <legend>Remote Querying Configuration</legend>

                        <FormGroup
                            label='Remote SQLite Binary Location'
                            labelFor='text-input'
                            subLabel='SQLite Binary Location'
                        >
                            <InputGroup
                                key='sqliteBinaryPath'
                                value={connection.sqliteBinaryPath}
                                onChange={(e) => setConnection({ ...connection, sqliteBinaryPath: e.target.value })}
                            />
                        </FormGroup>

                        <ButtonGroup className='remote-sql-test-buttons'>
                            <Button
                                text='Detect Path'
                                disabled={isTestingConnection}
                                loading={isTestingConnection}
                                onClick={getSqlitePath}
                            />
                        </ButtonGroup>
                    </fieldset>
                )}

                <fieldset>
                    <legend>Test Connection</legend>
                    {connectionTests.map((v) => {
                        return (
                            <ConnectionTestMessage
                                key={v.message}
                                status={v.status}
                                message={v.message}
                            />
                        );
                    })}

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

export default RemoteConnectionDialog;
