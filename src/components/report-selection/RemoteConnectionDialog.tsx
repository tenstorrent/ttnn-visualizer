// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import {
    Button,
    Checkbox,
    Dialog,
    DialogBody,
    DialogFooter,
    FormGroup,
    InputGroup,
    Intent,
    Tooltip,
} from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { AxiosError } from 'axios';
import classNames from 'classnames';
import { useState } from 'react';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { MULTIHOST_CHECKBOX_LABEL, RemoteConnection } from '../../definitions/RemoteConnection';
import { SSH_CONFIG_HOST_UNSELECTED } from '../../definitions/SshConfigHostPicker';
import {
    SSH_HOST_SUBLABEL,
    SSH_IDENTITY_FILE_LABEL,
    SSH_IDENTITY_FILE_PLACEHOLDER,
    SSH_IDENTITY_FILE_SUBLABEL,
    SSH_USERNAME_SUBLABEL,
} from '../../definitions/SshConnectionFields';
import { TEST_IDS } from '../../definitions/TestIds';
import { SshConfigHost } from '../../model/SshConfigHost';
import { isConnectionNameTaken } from '../../functions/remoteConnection';
import getServerConfig from '../../functions/getServerConfig';
import getSshConfigHostPrefill from '../../functions/getSshConfigHostPrefill';
import useRemoteConnection from '../../hooks/useRemote';
import useSshConfigHostOptions from '../../hooks/useSshConfigHostOptions';
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
    /** Already-saved connections, so this one can be told it is reusing a name. */
    existingConnections?: readonly RemoteConnection[];
}

// Shared and frozen so a caller that has no connections yet doesn't hand a new array each render.
const NO_CONNECTIONS: readonly RemoteConnection[] = Object.freeze([]);

const SSH_STATUS_PROGRESS = { status: ConnectionTestStates.PROGRESS, message: 'Testing SSH connection' };
// One placeholder per configured path, matching the single result the server
// returns for each: the path check and the report search report together.
const MEMORY_REPORT_SEARCH_STATUS = {
    status: ConnectionTestStates.PROGRESS,
    message: 'Searching for memory reports',
};
const PERFORMANCE_REPORT_SEARCH_STATUS = {
    status: ConnectionTestStates.PROGRESS,
    message: 'Searching for performance reports',
};
const FAILED_CONNECTION = { status: ConnectionTestStates.FAILED, message: 'Connection failed' };
const FAILED_MEMORY_REPORT_PATH = { status: ConnectionTestStates.FAILED, message: 'Memory report folder path failed' };
const MISSING_NAME_STATUS = {
    status: ConnectionTestStates.FAILED,
    // A connection saved without one is discarded as invalid the next time the list is read.
    message: 'Connection name is required',
};
const AVAILABLE_NAME_STATUS = { status: ConnectionTestStates.OK, message: 'Connection name is available' };

const getConnectionNameStatus = (name: string, isNameTaken: boolean): ConnectionStatus => {
    if (!name.trim()) {
        return MISSING_NAME_STATUS;
    }

    if (isNameTaken) {
        return {
            status: ConnectionTestStates.FAILED,
            message: `A connection named "${name.trim()}" already exists`,
        };
    }

    return AVAILABLE_NAME_STATUS;
};

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

const RemoteConnectionDialog = ({
    open,
    onSave,
    onClose,
    onAddConnection,
    title = 'Add new remote connection',
    buttonLabel = 'Add connection',
    remoteConnection,
    existingConnections = NO_CONNECTIONS,
}: RemoteConnectionDialogProps) => {
    const [connection, setConnection] = useState<Partial<RemoteConnection>>(
        () => remoteConnection ?? getDefaultConnection(),
    );
    const { selectedHost, selectHost, selectCustom, resetSelection } = useSshConfigHostSelection(
        remoteConnection?.host,
    );
    // The picker exists to seed a connection that has no values yet. An edit has them, and the
    // prefill overwrites the host, name, username, port and identity file together, so offering
    // it here is offering to undo the edit. Not asking also keeps ~/.ssh/config unread.
    const isAddingConnection = !remoteConnection;
    const { isAvailable: hasSshConfigHosts, isResolving: isResolvingSshConfig } = useSshConfigHostOptions(
        open && isAddingConnection,
    );
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>([]);
    const [hasStaleTestResults, setHasStaleTestResults] = useState(false);
    const { testConnection } = useRemoteConnection();
    const [isTestingConnection, setIsTestingconnection] = useState(false);

    // A new connection is a choice between the ~/.ssh/config aliases and filling the form in by
    // hand, so the form itself only competes with that choice. There is nothing to choose from
    // when the picker can't render — including while the config is still loading, which would
    // otherwise show the form only to take it away again.
    const isAwaitingHostChoice =
        isAddingConnection &&
        selectedHost === SSH_CONFIG_HOST_UNSELECTED &&
        (isResolvingSshConfig || hasSshConfigHosts);

    // Recomputed as the user types rather than captured by a test run: a rename deliberately
    // doesn't invalidate the SSH results, so a result frozen at run time would let a name later
    // edited into a duplicate keep its tick and be saved.
    const isNameTaken = isConnectionNameTaken(connection.name ?? '', existingConnections, remoteConnection);
    const nameStatus = getConnectionNameStatus(connection.name ?? '', isNameTaken);
    // A name that collides can only be something the user typed, so reporting it before they ask
    // for a test is feedback rather than an unprompted complaint. A name not filled in yet is the
    // latter, so it waits for the run that the rest of the results arrive with.
    const hasTestResults = connectionTests.length > 0 || isNameTaken;

    const isValidConnection =
        nameStatus.status === ConnectionTestStates.OK &&
        !hasStaleTestResults &&
        connectionTests.length > 0 &&
        connectionTests.every(
            ({ status }) => status === ConnectionTestStates.OK || status === ConnectionTestStates.WARNING,
        );
    // Everything the test actually exercises — the SSH target, the credentials, and the paths it
    // stats — invalidates a previous result. The name isn't part of the target, so it goes through
    // updateName instead: saving is gated on a passing test, and renaming shouldn't cost a fresh
    // SSH round-trip. Named for the distinction so a new field can't silently take the wrong path.
    const updateTarget = (changes: Partial<RemoteConnection>) => {
        setConnection({ ...connection, ...changes });
        // The results stay on screen as a record of the last run, but they
        // describe the previous target, so they can no longer gate the save.
        setHasStaleTestResults(true);
    };

    const updateName = (name: string) => setConnection({ ...connection, name });

    const testConnectionStatus = async () => {
        setIsTestingconnection(true);
        setHasStaleTestResults(false);

        const tests: ConnectionStatus[] = [SSH_STATUS_PROGRESS];

        if (connection.profilerPath) {
            tests.push(MEMORY_REPORT_SEARCH_STATUS);
        }

        if (connection.performancePath) {
            tests.push(PERFORMANCE_REPORT_SEARCH_STATUS);
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
        setHasStaleTestResults(false);
        onClose();
    };

    const handleSelectSshConfigHost = (host: SshConfigHost) => {
        selectHost(host.host);
        const defaults = getDefaultConnection();

        updateTarget(
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
                {isAddingConnection && (
                    <SshConfigHostPicker
                        value={selectedHost}
                        enabled={open}
                        onSelectCustom={selectCustom}
                        onSelectHost={handleSelectSshConfigHost}
                    />
                )}

                {!isAwaitingHostChoice && (
                    <>
                        <FormGroup
                            label='Name'
                            subLabel='Connection name'
                            labelFor='remote-connection-name'
                        >
                            <InputGroup
                                id='remote-connection-name'
                                key='name'
                                value={connection.name}
                                onChange={(e) => updateName(e.target.value)}
                            />
                        </FormGroup>

                        <FormGroup
                            label='SSH Host'
                            subLabel={SSH_HOST_SUBLABEL}
                            labelFor='remote-ssh-host'
                        >
                            <InputGroup
                                id='remote-ssh-host'
                                value={connection.host}
                                onChange={(e) => {
                                    selectCustom();
                                    updateTarget({ host: e.target.value });
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
                                    updateTarget({ username: e.target.value });
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
                                        updateTarget({ port: undefined });
                                    } else if (number > 0 && number < 99999) {
                                        updateTarget({ port: number });
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
                                onChange={(e) => updateTarget({ identityFile: e.target.value.trim() || undefined })}
                            />
                        </FormGroup>

                        <FormGroup
                            label='Remote memory report folder path'
                            subLabel='e.g., "/<PATH TO TT METAL>/generated/ttnn/reports/"'
                            labelFor='remote-memory-path'
                        >
                            <InputGroup
                                id='remote-memory-path'
                                value={connection.profilerPath}
                                onChange={(e) => updateTarget({ profilerPath: e.target.value })}
                            />
                        </FormGroup>

                        <FormGroup
                            label='Remote performance report folder path'
                            subLabel='e.g., "/<PATH TO TT METAL>/generated/profiler/reports/"'
                            labelFor='remote-performance-path'
                        >
                            <InputGroup
                                id='remote-performance-path'
                                value={connection.performancePath ?? ''}
                                onChange={(e) => updateTarget({ performancePath: e.target.value })}
                            />
                        </FormGroup>

                        <FormGroup
                            label='Multihost performance reports'
                            subLabel='Reports are found at "ttrun/rank0/reports/<REPORT>", so the path above must be the folder that directly contains the rank folders (e.g. "/<PATH TO TT METAL>/generated/profiler/ttrun/"). Single-host reports sitting directly under that path are not listed while this is on.'
                            labelFor='remote-performance-multihost'
                        >
                            <Checkbox
                                id='remote-performance-multihost'
                                label={MULTIHOST_CHECKBOX_LABEL}
                                checked={connection.multihostPerformance ?? false}
                                onChange={(e) => updateTarget({ multihostPerformance: e.currentTarget.checked })}
                            />
                        </FormGroup>
                    </>
                )}
            </DialogBody>

            {!isAwaitingHostChoice && (
                <DialogFooter
                    minimal
                    className='remote-connection-dialog-footer'
                    actions={
                        <>
                            <Button
                                text='Run tests'
                                disabled={isTestingConnection}
                                loading={isTestingConnection}
                                onClick={testConnectionStatus}
                            />

                            <Tooltip
                                content='Pass connection tests before saving'
                                disabled={isValidConnection}
                            >
                                <Button
                                    text={buttonLabel}
                                    intent={Intent.PRIMARY}
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
                        </>
                    }
                >
                    {hasTestResults && (
                        <fieldset>
                            <legend>Test Connection</legend>

                            <ConnectionTestMessage
                                status={nameStatus.status}
                                message={nameStatus.message}
                            />

                            {/* Server results only exist once a test has run. Editing a field the
                                test exercises leaves them on screen, marked as no longer applying —
                                which the name above never is, so it sits outside the marking. */}
                            <div
                                className={classNames('connection-test-results', {
                                    'stale-connection-tests': hasStaleTestResults,
                                })}
                                data-testid={TEST_IDS.CONNECTION_TEST_RESULTS}
                            >
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
                            </div>
                        </fieldset>
                    )}
                </DialogFooter>
            )}
        </Dialog>
    );
};

export default RemoteConnectionDialog;
