// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, ButtonGroup, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup } from '@blueprintjs/core';
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
    const defaultConnection = remoteConnection ?? {
        name: '',
        host: '',
        port: 22,
        profilerPath: '',
        username: '',
    };
    const defaultConnectionTests: ConnectionStatus[] = [
        { status: ConnectionTestStates.IDLE, message: 'Test connection' },
        { status: ConnectionTestStates.IDLE, message: 'Test profiler folder path' },
    ];
    const [connection, setConnection] = useState<Partial<RemoteConnection>>(defaultConnection);
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>(defaultConnectionTests);
    const { testConnection, fetchSqlitePath } = useRemoteConnection();
    const [isTestingConnection, setIsTestingconnection] = useState(false);
    const [isDetectingBinaryPath, setIsDetectingBinaryPath] = useState(false);

    const isValidConnection = connectionTests.every((status) => status.status === ConnectionTestStates.OK);

    const getSqlitePath = async () => {
        setIsDetectingBinaryPath(true);
        const status = await fetchSqlitePath(connection);
        if (status.status === ConnectionTestStates.OK) {
            setConnection({ ...connection, sqliteBinaryPath: status.message });
        }
        if (status.status === ConnectionTestStates.FAILED) {
            setConnection({ ...connection, sqliteBinaryPath: 'Path Not Found' });
        }
        setIsDetectingBinaryPath(false);
    };

    const testConnectionStatus = async () => {
        setIsTestingconnection(true);

        const sshStatus = { status: ConnectionTestStates.PROGRESS, message: 'Testing connection' };
        const reportFolderStatus = { status: ConnectionTestStates.PROGRESS, message: 'Testing profiler folder path' };
        const performanceFolderStatus = {
            status: ConnectionTestStates.PROGRESS,
            message: 'Testing performance folder path',
        };

        setConnectionTests([sshStatus, reportFolderStatus, performanceFolderStatus]);

        try {
            const statuses = await testConnection(connection);
            setConnectionTests(statuses);
        } catch (err) {
            // TODO: Look at error handling
            setConnectionTests([
                { status: ConnectionTestStates.FAILED, message: 'Connection failed' },
                { status: ConnectionTestStates.FAILED, message: 'Profiler folder path failed' },
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
                    label='Profiler folder path'
                    subLabel='Path to a remote folder with profiler reports e.g. "$HOME/work/ll-sw"'
                >
                    <InputGroup
                        key='path'
                        value={connection.profilerPath}
                        onChange={(e) => setConnection({ ...connection, profilerPath: e.target.value })}
                    />
                </FormGroup>

                <FormGroup
                    label='Performance folder path (optional)'
                    subLabel='Path to a remote folder with performance reports e.g. "$HOME/perf/env-123"'
                >
                    <InputGroup
                        key='path'
                        value={connection.performancePath}
                        onChange={(e) => setConnection({ ...connection, performancePath: e.target.value })}
                    />
                </FormGroup>

                {/* TODO: Disabled for now until we have a solution for out of date sqlite versions */}
                {/* <FormGroup>
                    <Checkbox
                        checked={connection.useRemoteQuerying}
                        label='Use Remote Querying'
                        onChange={(e) => setConnection({ ...connection, useRemoteQuerying: e.target.checked })}
                    />
                </FormGroup> */}
                {connection.useRemoteQuerying && (
                    <fieldset className='remote-querying-fieldset'>
                        <legend>Remote Querying Configuration</legend>

                        <FormGroup
                            label='Remote SQLite Binary Location'
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
                                disabled={isDetectingBinaryPath}
                                loading={isDetectingBinaryPath}
                                onClick={getSqlitePath}
                            />
                        </ButtonGroup>
                    </fieldset>
                )}

                <fieldset>
                    <legend>Test Connection</legend>
                    {connectionTests.map((test, index) => {
                        return (
                            <ConnectionTestMessage
                                key={`${test.message}-${index}`}
                                status={test.status}
                                message={test.message}
                            />
                        );
                    })}

                    <br />

                    <Button
                        text='Test Connection'
                        disabled={isTestingConnection || isDetectingBinaryPath}
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
