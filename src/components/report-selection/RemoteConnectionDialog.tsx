// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup } from '@blueprintjs/core';
import { AxiosError } from 'axios';
import { FC, useState } from 'react';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { RemoteConnection } from '../../definitions/RemoteConnection';
import useRemoteConnection from '../../hooks/useRemote';
import ConnectionTestMessage from './ConnectionTestMessage';
import 'styles/components/RemoteConnectionDialog.scss';

interface RemoteConnectionDialogProps {
    title?: string;
    buttonLabel?: string;
    open: boolean;
    onClose: () => void;
    onAddConnection: (connection: RemoteConnection) => void;
    remoteConnection?: RemoteConnection;
}

const SSH_STATUS_PROGRESS = { status: ConnectionTestStates.PROGRESS, message: 'Testing SSH connection' };
const MEMORY_REPORT_PATH_STATUS = {
    status: ConnectionTestStates.PROGRESS,
    message: 'Testing memory report folder path',
};
const PERFORMANCE_PATH_STATUS = {
    status: ConnectionTestStates.PROGRESS,
    message: 'Testing performance report folder path',
};
const FAILED_CONNECTION = { status: ConnectionTestStates.FAILED, message: 'Connection failed' };
const FAILED_MEMORY_REPORT_PATH = { status: ConnectionTestStates.FAILED, message: 'Memory report folder path failed' };

const DEFAULT_CONNECTION: RemoteConnection = {
    name: '',
    host: '',
    port: 22,
    profilerPath: '',
    username: '',
};

const RemoteConnectionDialog: FC<RemoteConnectionDialogProps> = ({
    open,
    onClose,
    onAddConnection,
    title = 'Add new remote connection',
    buttonLabel = 'Add connection',
    remoteConnection,
}) => {
    const connectionToTest = remoteConnection ?? DEFAULT_CONNECTION;
    const [connection, setConnection] = useState<Partial<RemoteConnection>>(connectionToTest);
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>([]);
    const { testConnection } = useRemoteConnection();
    const [isTestingConnection, setIsTestingconnection] = useState(false);
    const [isDetectingBinaryPath] = useState(false);

    const isValidConnection = connectionTests.every((status) => status.status === ConnectionTestStates.OK);

    const testConnectionStatus = async () => {
        setIsTestingconnection(true);

        const tests: ConnectionStatus[] = [SSH_STATUS_PROGRESS];

        if (connection.profilerPath) {
            tests.push(MEMORY_REPORT_PATH_STATUS);
        }

        if (connection.performancePath) {
            tests.push(PERFORMANCE_PATH_STATUS);
        }

        setConnectionTests(tests);

        try {
            const statuses = await testConnection(connection);
            setConnectionTests(statuses);
        } catch (err) {
            // Check if this is an axios error with response data (e.g., HTTP 422 for auth failures)
            const axiosError = err as AxiosError;
            if (axiosError.response && axiosError.response.data) {
                // Use the actual API response data which contains proper messages and details
                setConnectionTests(axiosError.response.data as ConnectionStatus[]);
            } else {
                // Fallback for other types of errors
                setConnectionTests([FAILED_CONNECTION, FAILED_MEMORY_REPORT_PATH]);
            }
        } finally {
            setIsTestingconnection(false);
        }
    };

    const closeDialog = () => {
        setConnection(connectionToTest);
        setConnectionTests([]);
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
                    subLabel='SSH host name (e.g., localhost)'
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
                    subLabel='Port to use for the SSH connection (e.g., port 22)'
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
                    label='Memory report folder path'
                    subLabel='Path to a remote folder containing memory reports (e.g., "/<PATH TO TT METAL>/generated/ttnn/reports/")'
                >
                    <InputGroup
                        key='path'
                        value={connection.profilerPath}
                        onChange={(e) => setConnection({ ...connection, profilerPath: e.target.value })}
                    />
                </FormGroup>

                <FormGroup
                    label='Performance report folder path (optional)'
                    subLabel='Path to a remote folder containing performance reports (e.g., "/<PATH TO TT METAL>/generated/profiler/reports/")'
                >
                    <InputGroup
                        key='path'
                        value={connection.performancePath}
                        onChange={(e) => setConnection({ ...connection, performancePath: e.target.value })}
                    />
                </FormGroup>

                <fieldset>
                    <legend>Test Connection</legend>
                    {connectionTests.map((test, index) => {
                        return (
                            <ConnectionTestMessage
                                key={`${test.message}-${index}`}
                                status={test.status}
                                message={test.message}
                                detail={test.detail}
                            />
                        );
                    })}

                    <br />

                    {connectionTests.length === 0 && (
                        <p>Ensure the SSH connection is working correctly and the remote path(s) are valid.</p>
                    )}

                    <Button
                        text='Run tests'
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
