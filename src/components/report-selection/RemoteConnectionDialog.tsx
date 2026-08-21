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
import { useState } from 'react';
import { ConnectionNameSubject, SAVE_BLOCKED_TOOLTIP, getNameFieldLabel } from '../../definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import {
    MULTIHOST_CHECKBOX_LABEL,
    MULTIHOST_GROUP_LABEL,
    REMOTE_MEMORY_PATH_LABEL,
    REMOTE_PERFORMANCE_PATH_LABEL,
    RemoteConnection,
} from '../../definitions/RemoteConnection';
import { SSH_CONFIG_HOST_ADD_CONNECTION_LABEL } from '../../definitions/SshConfigHostPicker';
import {
    REMOTE_MEMORY_PATH_ERROR_ID,
    REMOTE_PERFORMANCE_PATH_ERROR_ID,
    SSH_HOST_LABEL,
    SSH_HOST_SUBLABEL,
    SSH_IDENTITY_FILE_LABEL,
    SSH_IDENTITY_FILE_PLACEHOLDER,
    SSH_IDENTITY_FILE_SUBLABEL,
    SSH_PORT_LABEL,
    SSH_USERNAME_LABEL,
} from '../../definitions/SshConnectionFields';
import { SshConfigHost } from '../../model/SshConfigHost';
import { getConnectionNameStatus, isConnectionNameTaken } from '../../functions/connectionName';
import { isSameConnection } from '../../functions/remoteConnection';
import { getRemotePathError } from '../../functions/remotePath';
import getPortFromInput from '../../functions/getPortFromInput';
import getResponseError from '../../functions/getResponseError';
import getServerConfig from '../../functions/getServerConfig';
import getSshConfigHostPrefill from '../../functions/getSshConfigHostPrefill';
import isConnectionSaveable from '../../functions/isConnectionSaveable';
import useRemoteConnection from '../../hooks/useRemote';
import useHostKey, { HostKeyTarget } from '../../hooks/useHostKey';
import useSshConfigHostChoice from '../../hooks/useSshConfigHostChoice';
import ConnectionTestResults from './ConnectionTestResults';
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
    const isAddingConnection = !remoteConnection;
    const { selectedHost, selectHost, selectCustom, resetSelection, isAwaitingHostChoice } = useSshConfigHostChoice({
        open,
        isAdding: isAddingConnection,
        initialHost: remoteConnection?.host,
    });
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>([]);
    const [hasStaleTestResults, setHasStaleTestResults] = useState(false);
    const { testConnection } = useRemoteConnection();
    const { fetchHostKeyOffer, trustHostKey } = useHostKey();
    const [isTestingConnection, setIsTestingconnection] = useState(false);

    const connectionName = connection.name ?? '';
    // Recomputed as the user types rather than captured by a test run: a rename deliberately
    // doesn't invalidate the SSH results, so a result frozen at run time would let a name later
    // edited into a duplicate keep its tick and be saved.
    const isNameTaken = isConnectionNameTaken(connectionName, existingConnections, isSameConnection, remoteConnection);
    const nameStatus = getConnectionNameStatus(connectionName, isNameTaken, ConnectionNameSubject.CONNECTION);

    const profilerPathError = getRemotePathError(connection.profilerPath);
    const performancePathError = getRemotePathError(connection.performancePath);
    const hasPathError = profilerPathError !== null || performancePathError !== null;

    const isValidConnection = !hasPathError && isConnectionSaveable(nameStatus, connectionTests, hasStaleTestResults);

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
            // Only a status list can be rendered as one. A rejected field gives
            // `{ error: … }` instead, which would otherwise reach `.map` as a non-array.
            if (Array.isArray(axiosError.response?.data)) {
                // Use the actual API response data which contains proper messages and details
                setConnectionTests(axiosError.response.data as ConnectionStatus[]);
            } else {
                const detail = getResponseError(err);
                setConnectionTests([{ ...FAILED_CONNECTION, detail }, FAILED_MEMORY_REPORT_PATH]);
            }
        } finally {
            setIsTestingconnection(false);
        }
    };

    // This dialog is the only place holding both the form and the test runner, so the
    // host-key prompt reaches them through here rather than learning the connection shape.
    // `connection` is a Partial, so host and port are narrowed even though
    // getDefaultConnection seeds both — the backend rejects an empty host anyway.
    const getHostKeyTarget = (): HostKeyTarget => ({
        host: connection.host ?? '',
        port: connection.port ?? getServerConfig().SSH_DEFAULT_PORT,
        identityFile: connection.identityFile,
        username: connection.username,
    });

    const handleRequestHostKeyOffer = () => fetchHostKeyOffer(getHostKeyTarget());

    const handleTrustHost = async (fingerprints: readonly string[]) => {
        await trustHostKey(getHostKeyTarget(), fingerprints);
        // Re-run rather than assume: trusting the key clears one reason the connection
        // failed, not necessarily the only one, and the save gate reads the results.
        await testConnectionStatus();
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
                        addNewLabel={SSH_CONFIG_HOST_ADD_CONNECTION_LABEL}
                        enabled={open}
                        onSelectCustom={selectCustom}
                        onSelectHost={handleSelectSshConfigHost}
                    />
                )}

                {!isAwaitingHostChoice && (
                    <>
                        <FormGroup
                            label={getNameFieldLabel(ConnectionNameSubject.CONNECTION)}
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
                            label={SSH_HOST_LABEL}
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
                            label={SSH_USERNAME_LABEL}
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
                            label={SSH_PORT_LABEL}
                            labelFor='remote-ssh-port'
                        >
                            <InputGroup
                                id='remote-ssh-port'
                                value={connection.port?.toString() ?? ''}
                                onChange={(e) => {
                                    const port = getPortFromInput(e.target.value, undefined);

                                    if (port !== null) {
                                        updateTarget({ port });
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
                            label={REMOTE_MEMORY_PATH_LABEL}
                            subLabel='e.g., "/<PATH TO TT METAL>/generated/ttnn/reports/"'
                            labelFor='remote-memory-path'
                            intent={profilerPathError ? Intent.DANGER : undefined}
                            helperText={
                                profilerPathError && <span id={REMOTE_MEMORY_PATH_ERROR_ID}>{profilerPathError}</span>
                            }
                        >
                            <InputGroup
                                id='remote-memory-path'
                                intent={profilerPathError ? Intent.DANGER : undefined}
                                // Blueprint colours the field but tells assistive tech nothing, so the
                                // error is announced only if the input points at it itself.
                                aria-invalid={profilerPathError !== null}
                                aria-describedby={profilerPathError ? REMOTE_MEMORY_PATH_ERROR_ID : undefined}
                                value={connection.profilerPath}
                                onChange={(e) => updateTarget({ profilerPath: e.target.value })}
                            />
                        </FormGroup>

                        <FormGroup
                            label={REMOTE_PERFORMANCE_PATH_LABEL}
                            subLabel='e.g., "/<PATH TO TT METAL>/generated/profiler/reports/"'
                            labelFor='remote-performance-path'
                            intent={performancePathError ? Intent.DANGER : undefined}
                            helperText={
                                performancePathError && (
                                    <span id={REMOTE_PERFORMANCE_PATH_ERROR_ID}>{performancePathError}</span>
                                )
                            }
                        >
                            <InputGroup
                                id='remote-performance-path'
                                intent={performancePathError ? Intent.DANGER : undefined}
                                aria-invalid={performancePathError !== null}
                                aria-describedby={performancePathError ? REMOTE_PERFORMANCE_PATH_ERROR_ID : undefined}
                                value={connection.performancePath ?? ''}
                                onChange={(e) => updateTarget({ performancePath: e.target.value })}
                            />
                        </FormGroup>

                        <FormGroup
                            label={MULTIHOST_GROUP_LABEL}
                            subLabel='Reports are found at "ttrun/rank0/reports/<REPORT>", so the path above must be the folder that directly contains the rank folders (e.g. "/<PATH TO TT METAL>/generated/profiler/ttrun/"). Single-host reports will be ignored.'
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
                    className='connection-dialog-footer'
                    actions={
                        <>
                            <Button
                                text='Run tests'
                                disabled={isTestingConnection || hasPathError}
                                loading={isTestingConnection}
                                onClick={testConnectionStatus}
                            />

                            <Tooltip
                                content={SAVE_BLOCKED_TOOLTIP}
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

                                            // The add dialog stays mounted between opens, so
                                            // without this the next one starts on the connection
                                            // just saved — and reports it as a duplicate.
                                            closeDialog(true);
                                        }
                                    }}
                                />
                            </Tooltip>
                        </>
                    }
                >
                    <ConnectionTestResults
                        nameStatus={nameStatus}
                        isNameTaken={isNameTaken}
                        tests={connectionTests}
                        isStale={hasStaleTestResults}
                        onRequestHostKeyOffer={handleRequestHostKeyOffer}
                        onTrustHost={handleTrustHost}
                    />
                </DialogFooter>
            )}
        </Dialog>
    );
};

export default RemoteConnectionDialog;
