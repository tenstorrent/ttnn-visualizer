// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { AxiosError } from 'axios';
import { useState } from 'react';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { RemoteConnection } from '../../definitions/RemoteConnection';
import {
    SSH_IDENTITY_FILE_LABEL,
    SSH_IDENTITY_FILE_PLACEHOLDER,
    SSH_IDENTITY_FILE_SUBLABEL,
    SSH_USERNAME_SUBLABEL,
} from '../../definitions/SshConnectionFields';
import { SshConfigHost } from '../../model/SshConfigHost';
import getServerConfig from '../../functions/getServerConfig';
import getSshConfigHostPrefill from '../../functions/getSshConfigHostPrefill';
import useRemoteConnection from '../../hooks/useRemote';
import useSshConfigHostSelection from '../../hooks/useSshConfigHostSelection';
import ConnectionTestMessage from './ConnectionTestMessage';
import SshConfigHostPicker from './SshConfigHostPicker';
import 'styles/components/RemoteConnectionDialog.scss';

interface RemoteConnectionDialogProps {
    title?: string;
    buttonLabel?: string;
    open: boolean;
    onSave?: (connection: RemoteConnection) => void;
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

const getDefaultConnection = (): RemoteConnection => {
    const serverConfig = getServerConfig();

    return {
        name: '',
        host: '',
        port: serverConfig.SSH_DEFAULT_PORT,
        profilerPath: serverConfig.SSH_DEFAULT_PROFILER_PATH,
        performancePath: serverConfig.SSH_DEFAULT_PERFORMANCE_PATH,
        username: serverConfig.USERNAME ?? '',
    };
};

const shellQuote = (value: string): string => `'${value.replace(/'/g, `'"'"'`)}'`;

const formatRemoteTestPreview = (connection: Partial<RemoteConnection>) => {
    const sshIdentity = connection.identityFile ? ` -i ${shellQuote(connection.identityFile)}` : '';
    const pathChecks = [connection.profilerPath, connection.performancePath]
        .filter((path): path is string => Boolean(path && path.trim() !== ''))
        .map((path) => `test -e ${shellQuote(path)}`)
        .join(' && ');

    const remoteCommand = pathChecks !== '' ? pathChecks : 'echo SSH connection OK';
    const target = `${connection.username}@${connection.host}`;

    return `ssh${sshIdentity} -p ${connection.port} ${shellQuote(target)} ${shellQuote(remoteCommand)}`;
};

const RemoteConnectionDialog = ({
    open,
    onSave,
    onClose,
    onAddConnection,
    title = 'Add new remote connection',
    buttonLabel = 'Add connection',
    remoteConnection,
}: RemoteConnectionDialogProps) => {
    const [connection, setConnection] = useState<Partial<RemoteConnection>>(
        () => remoteConnection ?? getDefaultConnection(),
    );
    const { selectedHost, selectHost, selectCustom, resetSelection } = useSshConfigHostSelection(
        remoteConnection?.host,
    );
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>([]);
    const { testConnection } = useRemoteConnection();
    const [isTestingConnection, setIsTestingconnection] = useState(false);

    const isValidConnection =
        connectionTests.length > 0 &&
        connectionTests.every(
            ({ status }) => status === ConnectionTestStates.OK || status === ConnectionTestStates.WARNING,
        );
    const hasConnectionTestPreview =
        connection.username?.trim() &&
        connection.host?.trim() &&
        connection.port &&
        (connection.profilerPath?.trim() || connection.performancePath?.trim());

    // Everything the test actually exercises — the SSH target, the credentials, and the
    // paths it stats — invalidates a previous result. The connection name doesn't.
    const updateConnection = (changes: Partial<RemoteConnection>) => {
        setConnection({ ...connection, ...changes });
        setConnectionTests([]);
    };

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

    const closeDialog = (resetChanges?: boolean) => {
        if (resetChanges) {
            setConnection(remoteConnection ?? getDefaultConnection());
            resetSelection();
        }

        setConnectionTests([]);
        onClose();
    };

    const handleSelectSshConfigHost = (host: SshConfigHost) => {
        selectHost(host.host);
        const defaults = getDefaultConnection();

        updateConnection(
            getSshConfigHostPrefill(host, {
                name: connection.name,
                username: connection.username,
                port: connection.port,
                defaultUsername: defaults.username,
                defaultPort: defaults.port,
            }),
        );
    };

    return (
        <Dialog
            className='remote-connection-dialog'
            title={title} // Blueprint Dialog renders a H6 here regardless of what markup you pass here
            icon={IconNames.CLOUD_SERVER}
            canOutsideClickClose={false}
            isOpen={open}
            onClose={() => closeDialog(true)}
        >
            <DialogBody>
                <SshConfigHostPicker
                    value={selectedHost}
                    enabled={open}
                    onSelectCustom={selectCustom}
                    onSelectHost={handleSelectSshConfigHost}
                />

                <FormGroup
                    label='Name'
                    subLabel='Connection name'
                    labelFor='remote-connection-name'
                >
                    <InputGroup
                        id='remote-connection-name'
                        key='name'
                        value={connection.name}
                        onChange={(e) => setConnection({ ...connection, name: e.target.value })}
                    />
                </FormGroup>

                <FormGroup
                    label='SSH Host'
                    subLabel='SSH host alias or hostname (e.g. work-gpu or localhost)'
                    labelFor='remote-ssh-host'
                >
                    <InputGroup
                        id='remote-ssh-host'
                        value={connection.host}
                        onChange={(e) => {
                            selectCustom();
                            updateConnection({ host: e.target.value });
                        }}
                    />
                </FormGroup>

                <FormGroup
                    label='Username'
                    subLabel={SSH_USERNAME_SUBLABEL}
                    labelFor='remote-ssh-username'
                >
                    <InputGroup
                        id='remote-ssh-username'
                        value={connection.username ?? ''}
                        onChange={(e) => {
                            updateConnection({ username: e.target.value });
                        }}
                    />
                </FormGroup>

                <FormGroup
                    label='SSH Port'
                    subLabel='Port to use for the SSH connection (e.g., port 22)'
                    labelFor='remote-ssh-port'
                >
                    <InputGroup
                        id='remote-ssh-port'
                        value={connection.port?.toString() ?? ''}
                        onChange={(e) => {
                            const number = Number.parseInt(e.target.value, 10);

                            if (e.target.value === '') {
                                updateConnection({ port: undefined });
                            } else if (number > 0 && number < 99999) {
                                updateConnection({ port: number });
                            }
                        }}
                    />
                </FormGroup>

                <FormGroup
                    label={SSH_IDENTITY_FILE_LABEL}
                    subLabel={SSH_IDENTITY_FILE_SUBLABEL}
                    labelFor='remote-ssh-identity'
                >
                    <InputGroup
                        id='remote-ssh-identity'
                        placeholder={SSH_IDENTITY_FILE_PLACEHOLDER}
                        value={connection.identityFile ?? ''}
                        onChange={(e) => updateConnection({ identityFile: e.target.value.trim() || undefined })}
                    />
                </FormGroup>

                <FormGroup
                    label='Memory report folder path'
                    subLabel='Path to a remote folder containing memory reports (e.g., "/<PATH TO TT METAL>/generated/ttnn/reports/")'
                    labelFor='remote-memory-path'
                >
                    <InputGroup
                        id='remote-memory-path'
                        value={connection.profilerPath}
                        onChange={(e) => updateConnection({ profilerPath: e.target.value })}
                    />
                </FormGroup>

                <FormGroup
                    label='Performance report folder path'
                    subLabel='Path to a remote folder containing performance reports (e.g., "/<PATH TO TT METAL>/generated/profiler/reports/")'
                    labelFor='remote-performance-path'
                >
                    <InputGroup
                        id='remote-performance-path'
                        value={connection.performancePath ?? ''}
                        onChange={(e) => updateConnection({ performancePath: e.target.value })}
                    />
                </FormGroup>

                {hasConnectionTestPreview && (
                    <FormGroup
                        label='Connection test'
                        subLabel='SSH into the remote host and check configured folder paths'
                    >
                        <code>{formatRemoteTestPreview(connection)}</code>
                    </FormGroup>
                )}

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

                    {connectionTests.length === 0 && <p>Check SSH connection is valid</p>}

                    <Button
                        text='Run tests'
                        disabled={isTestingConnection}
                        loading={isTestingConnection}
                        onClick={testConnectionStatus}
                    />
                </fieldset>
            </DialogBody>

            <DialogFooter
                minimal
                actions={
                    <Tooltip
                        content='Resolve any failed checks before saving'
                        disabled={isValidConnection}
                    >
                        <Button
                            text={buttonLabel}
                            disabled={!isValidConnection}
                            onClick={() => {
                                if (isValidConnection) {
                                    onAddConnection(connection as RemoteConnection);

                                    if (onSave) {
                                        onSave(connection as RemoteConnection);
                                    }

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

export default RemoteConnectionDialog;
