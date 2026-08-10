// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Dialog, DialogBody, DialogFooter, FormGroup, InputGroup, Intent, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { useState } from 'react';
import { ConnectionNameSubject, SAVE_BLOCKED_TOOLTIP, getNameFieldLabel } from '../../definitions/ConnectionDialog';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { MLIR_PORT_LABEL, MlirServerConnection } from '../../definitions/MlirServer';
import { SSH_CONFIG_HOST_ADD_SERVER_LABEL } from '../../definitions/SshConfigHostPicker';
import {
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
import { isSameMlirServer } from '../../functions/mlirServer';
import getPortFromInput from '../../functions/getPortFromInput';
import getServerConfig from '../../functions/getServerConfig';
import getSshConfigHostPrefill from '../../functions/getSshConfigHostPrefill';
import isConnectionSaveable from '../../functions/isConnectionSaveable';
import useMlirRemote from '../../hooks/useMlirRemote';
import useSshConfigHostChoice from '../../hooks/useSshConfigHostChoice';
import ConnectionTestResults from './ConnectionTestResults';
import SshConfigHostPicker from './SshConfigHostPicker';
import 'styles/components/RemoteConnectionDialog.scss';

interface MlirServerDialogProps {
    open: boolean;
    title?: string;
    buttonLabel?: string;
    server?: MlirServerConnection;
    /** Already-saved servers, so this one can be told it is reusing a name. */
    existingServers?: readonly MlirServerConnection[];
    onAddServer: (server: MlirServerConnection) => void;
    onClose: () => void;
}

// Shared and frozen so a caller that has no servers yet doesn't hand a new array each render.
const NO_SERVERS: readonly MlirServerConnection[] = Object.freeze([]);

const getDefaultServer = (): MlirServerConnection => {
    const serverConfig = getServerConfig();

    return {
        name: '',
        username: serverConfig.USERNAME ?? '',
        host: '',
        sshPort: serverConfig.SSH_DEFAULT_PORT,
        port: 8080,
    };
};

// Both ports are required numbers here, so a cleared field holds zero rather than nothing —
// which is what `hasTestableTarget` already reads as a target the test cannot reach.
const EMPTY_PORT = 0;

const TEST_PROGRESS: ConnectionStatus = {
    status: ConnectionTestStates.PROGRESS,
    message: 'Testing MLIR server connection over SSH',
};

const LOCALHOST_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);

const isLocalhostSshHost = (host: string) => LOCALHOST_HOSTNAMES.has(host.trim().toLowerCase());

const MlirServerDialog = ({
    open,
    title = 'Add MLIR server',
    buttonLabel = 'Add server',
    server,
    existingServers = NO_SERVERS,
    onAddServer,
    onClose,
}: MlirServerDialogProps) => {
    const { testMlirServerConnection } = useMlirRemote();
    const [connection, setConnection] = useState<MlirServerConnection>(() => server ?? getDefaultServer());
    const isAddingServer = !server;
    const { selectedHost, selectHost, selectCustom, resetSelection, isAwaitingHostChoice } = useSshConfigHostChoice({
        open,
        isAdding: isAddingServer,
        initialHost: server?.host,
    });
    const [connectionTests, setConnectionTests] = useState<ConnectionStatus[]>([]);
    const [hasStaleTestResults, setHasStaleTestResults] = useState(false);
    const [isTestingConnection, setIsTestingConnection] = useState(false);

    // Recomputed as the user types rather than captured by a test run: a rename deliberately
    // doesn't invalidate the SSH results, so a result frozen at run time would let a name later
    // edited into a duplicate keep its tick and be saved.
    const isNameTaken = isConnectionNameTaken(connection.name, existingServers, isSameMlirServer, server);
    const nameStatus = getConnectionNameStatus(connection.name, isNameTaken, ConnectionNameSubject.SERVER);

    // What the test needs to reach the server at all. The name isn't part of that, so a missing
    // one is reported alongside the results rather than withholding the run that produces them.
    const hasTestableTarget =
        connection.username.trim() !== '' &&
        connection.host.trim() !== '' &&
        !isLocalhostSshHost(connection.host) &&
        connection.sshPort > 0 &&
        connection.port > 0;

    const isValidConnection = isConnectionSaveable(nameStatus, connectionTests, hasStaleTestResults);

    // Everything the test actually exercises — the SSH target, the credentials, and the port it
    // probes — invalidates a previous result. The name isn't part of the target, so it goes through
    // updateName instead: saving is gated on a passing test, and renaming shouldn't cost a fresh
    // SSH round-trip. Named for the distinction so a new field can't silently take the wrong path.
    const updateTarget = (changes: Partial<MlirServerConnection>) => {
        setConnection({ ...connection, ...changes });
        // The results stay on screen as a record of the last run, but they
        // describe the previous target, so they can no longer gate the save.
        setHasStaleTestResults(true);
    };

    const updateName = (name: string) => setConnection({ ...connection, name });

    const testConnectionStatus = async () => {
        setIsTestingConnection(true);
        setHasStaleTestResults(false);
        setConnectionTests([TEST_PROGRESS]);

        const statuses = await testMlirServerConnection(connection);

        setConnectionTests(statuses);
        setIsTestingConnection(false);
    };

    const closeDialog = (resetChanges?: boolean) => {
        if (resetChanges) {
            setConnection(server ?? getDefaultServer());
            resetSelection();
        }

        setConnectionTests([]);
        setHasStaleTestResults(false);
        onClose();
    };

    const handleSelectSshConfigHost = (host: SshConfigHost) => {
        selectHost(host.host);
        const defaults = getDefaultServer();
        const { port, ...prefill } = getSshConfigHostPrefill(host, {
            name: connection.name,
            username: connection.username,
            port: connection.sshPort,
            defaultUsername: defaults.username,
            defaultPort: defaults.sshPort,
        });

        // The config stanza's Port is the SSH port; the MLIR server port is unrelated.
        updateTarget({ ...prefill, sshPort: port });
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
                {isAddingServer && (
                    <SshConfigHostPicker
                        value={selectedHost}
                        addNewLabel={SSH_CONFIG_HOST_ADD_SERVER_LABEL}
                        enabled={open}
                        onSelectCustom={selectCustom}
                        onSelectHost={handleSelectSshConfigHost}
                    />
                )}

                {!isAwaitingHostChoice && (
                    <>
                        <FormGroup
                            label={getNameFieldLabel(ConnectionNameSubject.SERVER)}
                            labelFor='mlir-server-name'
                        >
                            <InputGroup
                                id='mlir-server-name'
                                value={connection.name}
                                onChange={(e) => updateName(e.target.value)}
                            />
                        </FormGroup>

                        <FormGroup
                            label={SSH_USERNAME_LABEL}
                            labelFor='mlir-server-username'
                        >
                            <InputGroup
                                id='mlir-server-username'
                                value={connection.username}
                                onChange={(e) => updateTarget({ username: e.target.value })}
                            />
                        </FormGroup>

                        <FormGroup
                            label={SSH_HOST_LABEL}
                            subLabel={SSH_HOST_SUBLABEL}
                            labelFor='mlir-server-host'
                        >
                            <InputGroup
                                id='mlir-server-host'
                                placeholder='aus-wh-05'
                                intent={isLocalhostSshHost(connection.host) ? Intent.DANGER : Intent.NONE}
                                value={connection.host}
                                onChange={(e) => {
                                    selectCustom();
                                    updateTarget({ host: e.target.value });
                                }}
                            />
                            {isLocalhostSshHost(connection.host) && (
                                <p className='bp6-text-muted'>
                                    Use the remote hostname (e.g. aus-wh-05), not localhost. The app SSHes to this host,
                                    then probes the MLIR server on that machine&apos;s loopback.
                                </p>
                            )}
                        </FormGroup>

                        <FormGroup
                            label={SSH_PORT_LABEL}
                            labelFor='mlir-server-ssh-port'
                        >
                            <InputGroup
                                id='mlir-server-ssh-port'
                                value={connection.sshPort?.toString() ?? ''}
                                onChange={(e) => {
                                    const sshPort = getPortFromInput(e.target.value, EMPTY_PORT);

                                    if (sshPort !== null) {
                                        updateTarget({ sshPort });
                                    }
                                }}
                            />
                        </FormGroup>

                        <FormGroup
                            label={MLIR_PORT_LABEL}
                            subLabel='HTTP port the MLIR server listens on, on the remote host (e.g. 8080)'
                            labelFor='mlir-server-port'
                        >
                            <InputGroup
                                id='mlir-server-port'
                                value={connection.port?.toString() ?? ''}
                                onChange={(e) => {
                                    const port = getPortFromInput(e.target.value, EMPTY_PORT);

                                    if (port !== null) {
                                        updateTarget({ port });
                                    }
                                }}
                            />
                        </FormGroup>

                        <FormGroup
                            label={SSH_IDENTITY_FILE_LABEL}
                            subLabel={SSH_IDENTITY_FILE_SUBLABEL}
                            labelFor='mlir-server-identity'
                        >
                            <InputGroup
                                id='mlir-server-identity'
                                placeholder={SSH_IDENTITY_FILE_PLACEHOLDER}
                                value={connection.identityFile ?? ''}
                                onChange={(e) => updateTarget({ identityFile: e.target.value.trim() || undefined })}
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
                                text='Run test'
                                disabled={!hasTestableTarget || isTestingConnection}
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
                                            onAddServer(connection);

                                            // The add dialog stays mounted between opens, so
                                            // without this the next one starts on the server just
                                            // saved — and reports it as a duplicate.
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
                    />
                </DialogFooter>
            )}
        </Dialog>
    );
};

export default MlirServerDialog;
