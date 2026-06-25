// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Button, Callout, FormGroup, Intent, MenuItem, PopoverPosition, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ItemRenderer, Select } from '@blueprintjs/select';
import { useAtom } from 'jotai';
import { useState } from 'react';
import { MlirServerConnection, isSameMlirServer, mlirServerKey } from '../../definitions/MlirServer';
import { mlirServersAtom, selectedMlirServerAtom } from '../../store/app';
import MlirJsonFileLoader from '../mlir/MlirJsonFileLoader';
import MlirServerDialog from './MlirServerDialog';
import 'styles/components/MlirFileSelector.scss';

const EDIT_SERVER_LABEL = 'Edit selected server';
const REMOVE_SERVER_LABEL = 'Remove selected server';

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
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

    const activeServer = servers.find((server) => isSameMlirServer(server, selectedServer)) ?? servers[0] ?? null;

    const renderServer: ItemRenderer<MlirServerConnection> = (server, { handleClick, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }

        return (
            <MenuItem
                key={mlirServerKey(server)}
                text={formatServerString(server)}
                active={isSameMlirServer(server, activeServer)}
                onClick={handleClick}
                roleStructure='listoption'
            />
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
                        onClick={() => setIsAddDialogOpen(true)}
                    />
                </div>

                <MlirServerDialog
                    open={isAddDialogOpen}
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
                <div className='form-container mlir-server-select-row'>
                    <Select<MlirServerConnection>
                        items={servers}
                        itemRenderer={renderServer}
                        disabled={servers.length === 0}
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
                            disabled={servers.length === 0}
                            text={formatServerString(activeServer)}
                        />
                    </Select>

                    <Tooltip
                        content={EDIT_SERVER_LABEL}
                        position={PopoverPosition.TOP}
                    >
                        <Button
                            aria-label={EDIT_SERVER_LABEL}
                            icon={IconNames.EDIT}
                            disabled={!activeServer}
                            onClick={() => setIsEditDialogOpen(true)}
                        />
                    </Tooltip>

                    <Tooltip
                        content={REMOVE_SERVER_LABEL}
                        position={PopoverPosition.TOP}
                    >
                        <Button
                            aria-label={REMOVE_SERVER_LABEL}
                            icon={IconNames.TRASH}
                            disabled={!activeServer}
                            onClick={() => {
                                const remaining = servers.filter((server) => !isSameMlirServer(server, activeServer));
                                setServers(remaining);
                                setSelectedServer(remaining[0] ?? null);
                            }}
                        />
                    </Tooltip>
                </div>

                {activeServer && isEditDialogOpen && (
                    <MlirServerDialog
                        open={isEditDialogOpen}
                        title='Edit MLIR server'
                        buttonLabel='Save server'
                        server={activeServer}
                        onAddServer={(updated) => {
                            setServers(
                                servers.map((server) => (isSameMlirServer(server, activeServer) ? updated : server)),
                            );
                            setSelectedServer(updated);
                        }}
                        onClose={() => setIsEditDialogOpen(false)}
                    />
                )}
            </FormGroup>

            <FormGroup
                className='form-group'
                label={<h3 className='label'>Model file</h3>}
                subLabel='Upload a single model file (.mlir, .mlirbc, .pb, .pbtxt, .graphdef, .tflite, .json, .pt2)'
            >
                {activeServer ? (
                    <MlirJsonFileLoader server={activeServer} />
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
