// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Callout, FormGroup, Intent, MenuItem } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { MlirServerConnection } from '../../definitions/MlirServer';
import { getActiveMlirServer, isSameMlirServer, mlirServerKey } from '../../functions/mlirServer';
import { useActivatingReport } from '../../hooks/useActivatingReport';
import { mlirServersAtom, selectedMlirServerAtom } from '../../store/app';
import { ManagedEntity } from '../../definitions/ManagedEntity';
import { TEST_IDS } from '../../definitions/TestIds';
import ConfirmDeleteAlert from '../ConfirmDeleteAlert';
import MlirJsonFileLoader from '../mlir/MlirJsonFileLoader';
import MlirServerDialog from './MlirServerDialog';
import SelectRowActions from './SelectRowActions';
import 'styles/components/MlirFileSelector.scss';

const formatServerString = (server?: MlirServerConnection | null) => {
    if (!server) {
        return '(No server)';
    }

    return `${server.name} — ssh ${server.host}:${server.sshPort}, MLIR :${server.port}`;
};

const MLIRFileSelector = () => {
    const [servers, setServers] = useAtom(mlirServersAtom);
    const [selectedServer, setSelectedServer] = useAtom(selectedMlirServerAtom);
    const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
    const [serverToEdit, setServerToEdit] = useState<MlirServerConnection | null>(null);
    const [serverToDelete, setServerToDelete] = useState<MlirServerConnection | null>(null);
    const { isActivatingReport } = useActivatingReport();

    const activeServer = getActiveMlirServer(servers, selectedServer);
    const isServerSelectDisabled = isActivatingReport || servers.length === 0;

    const removeServer = (server: MlirServerConnection) => {
        const remaining = servers.filter((candidate) => !isSameMlirServer(candidate, server));

        setServers(remaining);

        // Removing another row from the dropdown must leave the server in use alone.
        if (isSameMlirServer(server, activeServer)) {
            setSelectedServer(remaining[0] ?? null);
        }
    };

    const renderServer: ItemRenderer<MlirServerConnection> = (server, { handleClick, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            // Presentational for the same reason as the other selectors: MenuItem owns the
            // <li role="option">, so this wrapper must not sit between it and the listbox.
            <div
                className='mlir-server-menu-item'
                role='none'
                data-testid={TEST_IDS.MLIR_SERVER_ROW}
                key={mlirServerKey(server)}
            >
                <MenuItem
                    text={formatServerString(server)}
                    active={isSameMlirServer(server, activeServer)}
                    disabled={modifiers.disabled}
                    onClick={handleClick}
                    roleStructure='listoption'
                />

                <SelectRowActions
                    entity={ManagedEntity.MLIR_SERVER}
                    itemName={server.name}
                    disabled={isActivatingReport}
                    onEdit={() => setServerToEdit(server)}
                    onDelete={() => setServerToDelete(server)}
                />
            </div>
        );
    };

    return (
        <>
            <FormGroup
                className='form-group'
                label={<h3 className='label'>Add MLIR server</h3>}
                subLabel='Add new MLIR server connection details'
            >
                <div className='form-container'>
                    <Button
                        icon={IconNames.PLUS}
                        text='Add new server'
                        disabled={isActivatingReport}
                        onClick={() => setIsAddDialogOpen(true)}
                    />
                </div>

                <MlirServerDialog
                    open={isAddDialogOpen}
                    existingServers={servers}
                    onAddServer={(server) => {
                        setServers([...servers, server]);
                        setSelectedServer(server);
                    }}
                    onClose={() => setIsAddDialogOpen(false)}
                />
            </FormGroup>

            <FormGroup
                className='form-group'
                label={<h3 className='label'>Use MLIR server</h3>}
                subLabel='Select the MLIR server used for uploads'
            >
                <div className='form-container'>
                    <Select<MlirServerConnection>
                        items={servers}
                        itemRenderer={renderServer}
                        disabled={isServerSelectDisabled}
                        filterable={false}
                        noResults={
                            <MenuItem
                                disabled
                                text='No servers'
                                roleStructure='listoption'
                            />
                        }
                        onItemSelect={setSelectedServer}
                    >
                        <Button
                            className='mlir-server-select-button'
                            icon={IconNames.CLOUD}
                            endIcon={IconNames.CARET_DOWN}
                            disabled={isServerSelectDisabled}
                            text={formatServerString(activeServer)}
                        />
                    </Select>
                </div>

                {serverToEdit && (
                    <MlirServerDialog
                        open
                        key={mlirServerKey(serverToEdit)}
                        title='Edit MLIR server'
                        buttonLabel='Save server'
                        server={serverToEdit}
                        existingServers={servers}
                        onAddServer={(updated) => {
                            setServers(
                                servers.map((server) => (isSameMlirServer(server, serverToEdit) ? updated : server)),
                            );

                            // Follow the rename only when the edited server was the one in use.
                            if (isSameMlirServer(serverToEdit, activeServer)) {
                                setSelectedServer(updated);
                            }
                        }}
                        onClose={() => setServerToEdit(null)}
                    />
                )}

                {serverToDelete && (
                    <ConfirmDeleteAlert
                        isOpen
                        entity={ManagedEntity.MLIR_SERVER}
                        entityName={serverToDelete.name}
                        onCancel={() => setServerToDelete(null)}
                        onConfirm={() => {
                            removeServer(serverToDelete);
                            setServerToDelete(null);
                        }}
                    />
                )}
            </FormGroup>

            <FormGroup
                className='form-group'
                label={<h3 className='label'>Model files</h3>}
                subLabel='Upload one or more model files (.mlir, .mlirbc, .pb, .pbtxt, .graphdef, .tflite, .json, .pt2)'
            >
                {activeServer ? (
                    <MlirJsonFileLoader
                        server={activeServer}
                        disabled={isActivatingReport}
                    />
                ) : (
                    <Callout
                        intent={Intent.NONE}
                        icon={IconNames.INFO_SIGN}
                    >
                        Add and select an MLIR server before uploading a file.
                    </Callout>
                )}
            </FormGroup>
        </>
    );
};

export default MLIRFileSelector;
