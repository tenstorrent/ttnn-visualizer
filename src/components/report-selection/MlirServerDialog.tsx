// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useState } from 'react';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { DEFAULT_SSH_PORT, MLIR_UPLOAD_PATH, MlirServerConnection } from '../../definitions/MlirServer';
import useMlirRemote from '../../hooks/useMlirRemote';
import ConnectionTestMessage from './ConnectionTestMessage';
import 'styles/components/RemoteConnectionDialog.scss';

interface MlirServerDialogProps {
    open: boolean;
    title?: string;
    buttonLabel?: string;
    server?: MlirServerConnection;
    onAddServer: (server: MlirServerConnection) => void;
    onClose: () => void;
}

const DEFAULT_SERVER: MlirServerConnection = {
    name: '',
    username: '',
    host: '',
    sshPort: DEFAULT_SSH_PORT,
    port: 8080,
};

const TEST_PROGRESS: ConnectionStatus = {
    status: ConnectionTestStates.PROGRESS,
    message: 'Testing MLIR server connection over SSH',
};

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const isLocalhostSshHost = (host: string) => LOCALHOST_HOSTNAMES.has(host.trim().toLowerCase());

const formatMlirTestPreview = (connection: MlirServerConnection) =>
    `Test: ssh -p ${connection.sshPort} ${connection.username}@${connection.host} ` +
    `→ curl http://127.0.0.1:${connection.port}${MLIR_UPLOAD_PATH} on remote`;

const formatMlirUploadPreview = (connection: MlirServerConnection) =>
    `Upload: ssh -p ${connection.sshPort} ${connection.username}@${connection.host} ` +
    `→ curl http://127.0.0.1:${connection.port}${MLIR_UPLOAD_PATH} on remote`;

const MlirServerDialog = ({
    open,
    title = 'Add MLIR server',
    buttonLabel = 'Add server',
    server,
    onAddServer,
    onClose,
}: MlirServerDialogProps) => {
    const { testMlirServerConnection } = useMlirRemote();
    const [connection, setConnection] = useState<MlirServerConnection>(server ?? DEFAULT_SERVER);
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>([]);
    const [isTestingConnection, setIsTestingConnection] = useState(false);

    const hasRequiredFields =
        connection.name.trim() !== '' &&
        connection.username.trim() !== '' &&
        connection.host.trim() !== '' &&
        !isLocalhostSshHost(connection.host) &&
        connection.sshPort > 0 &&
        connection.port > 0;
    const isValidConnection =
        connectionTests.length > 0 && connectionTests.every(({ status }) => status === ConnectionTestStates.OK);

    const updateConnection = (changes: Partial<MlirServerConnection>) => {
        setConnection({ ...connection, ...changes });
        // Invalidate a previous test result whenever the target changes.
        setConnectionTests([]);
    };

    const testConnectionStatus = async () => {
        setIsTestingConnection(true);
        setConnectionTests([TEST_PROGRESS]);

        const statuses = await testMlirServerConnection(connection);

        setConnectionTests(statuses);
        setIsTestingConnection(false);
    };

    const closeDialog = (resetChanges?: boolean) => {
        if (resetChanges) {
            setConnection(server ?? DEFAULT_SERVER);
        }

        setConnectionTests([]);
        onClose();
    };

    return (
        <Dialog
            className='remote-connection-dialog'
            title={title}
            icon={IconNames.INFO_SIGN}
            canOutsideClickClose={false}
            isOpen={open}
            onClose={() => closeDialog(true)}
        >
            <DialogBody>
                <FormGroup
                    label='Name'
                    subLabel='Server name'
                    labelFor='mlir-server-name'
                >
                    <InputGroup
                        id='mlir-server-name'
                        value={connection.name}
                        onChange={(e) => updateConnection({ name: e.target.value })}
                    />
                </FormGroup>

                <FormGroup
                    label='Username'
                    subLabel='Username to connect with'
                    labelFor='mlir-server-username'
                >
                    <InputGroup
                        id='mlir-server-username'
                        value={connection.username}
                        onChange={(e) => updateConnection({ username: e.target.value })}
                    />
                </FormGroup>

                <FormGroup
                    label='SSH host'
                    subLabel='Machine you SSH into (not localhost — use the remote hostname, e.g. aus-wh-05)'
                    labelFor='mlir-server-host'
                >
                    <InputGroup
                        id='mlir-server-host'
                        placeholder='aus-wh-05'
                        intent={isLocalhostSshHost(connection.host) ? 'danger' : 'none'}
                        value={connection.host}
                        onChange={(e) => updateConnection({ host: e.target.value })}
                    />
                    {isLocalhostSshHost(connection.host) && (
                        <p className='bp6-text-muted'>
                            Use the remote hostname (e.g. aus-wh-05), not localhost. The app SSHes to this host, then
                            probes the MLIR server on that machine&apos;s loopback.
                        </p>
                    )}
                </FormGroup>

                <FormGroup
                    label='SSH port'
                    subLabel='SSH daemon port on the remote host (e.g. 45985)'
                    labelFor='mlir-server-ssh-port'
                >
                    <InputGroup
                        id='mlir-server-ssh-port'
                        value={connection.sshPort?.toString() ?? ''}
                        onChange={(e) => {
                            const number = Number.parseInt(e.target.value, 10);

                            if (e.target.value === '') {
                                updateConnection({ sshPort: 0 });
                            } else if (number > 0 && number < 99999) {
                                updateConnection({ sshPort: number });
                            }
                        }}
                    />
                </FormGroup>

                <FormGroup
                    label='MLIR port'
                    subLabel='HTTP port the MLIR server listens on, on the remote host (e.g. 8080)'
                    labelFor='mlir-server-port'
                >
                    <InputGroup
                        id='mlir-server-port'
                        value={connection.port?.toString() ?? ''}
                        onChange={(e) => {
                            const number = Number.parseInt(e.target.value, 10);

                            if (e.target.value === '') {
                                updateConnection({ port: 0 });
                            } else if (number > 0 && number < 99999) {
                                updateConnection({ port: number });
                            }
                        }}
                    />
                </FormGroup>

                <FormGroup
                    label='SSH identity file (optional)'
                    subLabel='Path to your private key on this machine (e.g. ~/.ssh/id_ed25519). Leave empty for default.'
                    labelFor='mlir-server-identity'
                >
                    <InputGroup
                        id='mlir-server-identity'
                        placeholder='Leave empty for default key'
                        value={connection.identityFile ?? ''}
                        onChange={(e) => updateConnection({ identityFile: e.target.value.trim() || undefined })}
                    />
                </FormGroup>

                {hasRequiredFields && (
                    <>
                        <FormGroup
                            label='Connection test'
                            subLabel='SSH into the remote host and probe the MLIR server on its loopback'
                        >
                            <code>{formatMlirTestPreview(connection)}</code>
                        </FormGroup>
                        <FormGroup
                            label='Upload'
                            subLabel='Proxied through this app to your local tunnel (avoids browser CORS)'
                        >
                            <code>{formatMlirUploadPreview(connection)}</code>
                        </FormGroup>
                    </>
                )}

                <fieldset>
                    <legend>Test Connection</legend>
                    {connectionTests.map((test, index) => (
                        <ConnectionTestMessage
                            key={`${test.message}-${index}`}
                            status={test.status}
                            message={test.message}
                            detail={test.detail}
                        />
                    ))}

                    <br />

                    {connectionTests.length === 0 && <p>Check the MLIR server connection is valid</p>}

                    <Button
                        text='Run test'
                        disabled={!hasRequiredFields || isTestingConnection}
                        loading={isTestingConnection}
                        onClick={testConnectionStatus}
                    />
                </fieldset>
            </DialogBody>

            <DialogFooter
                minimal
                actions={
                    <Tooltip
                        content='Run a successful connection test before saving'
                        disabled={isValidConnection}
                    >
                        <Button
                            text={buttonLabel}
                            disabled={!isValidConnection}
                            onClick={() => {
                                if (isValidConnection) {
                                    onAddServer(connection);
                                    closeDialog();
                                }
                            }}
                        />
                    </Tooltip>
                }
            />
        </Dialog>
    );
};

export default MlirServerDialog;
