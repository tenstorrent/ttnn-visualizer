// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FC, useEffect, useState } from 'react';

import { AnchorButton, Button, FormGroup, Tooltip } from '@blueprintjs/core';

import { IconNames } from '@blueprintjs/icons';
import { useAtom } from 'jotai';
import { useQueryClient } from 'react-query';
import { useNavigate } from 'react-router';
import { RemoteConnection, RemoteFolder } from '../../definitions/RemoteConnection';
import ROUTES from '../../definitions/routes';
import isRemoteFolderOutdated from '../../functions/isRemoteFolderOutdated';
import useRemote from '../../hooks/useRemote';
import { reportLocationAtom } from '../../store/app';
import AddRemoteConnection from './AddRemoteConnection';
import RemoteConnectionSelector from './RemoteConnectionSelector';
import RemoteFolderSelector from './RemoteFolderSelector';

const RemoteSyncConfigurator: FC = () => {
    const remote = useRemote();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [remoteFolderList, setRemoteFolders] = useState<RemoteFolder[]>(
        remote.persistentState.getSavedRemoteReports(remote.persistentState.selectedConnection),
    );
    const [reportLocation, setReportLocation] = useAtom(reportLocationAtom);

    const [isSyncingRemoteFolder, setIsSyncingRemoteFolder] = useState(false);
    const [isLoadingFolderList, setIsLoadingFolderList] = useState(false);
    const [isFetchingFolderStatus, setIsFetchingFolderStatus] = useState(false);
    const [isRemoteOffline, setIsRemoteOffline] = useState(false);
    const [selectedRemoteFolder, setSelectedRemoteFolder] = useState<RemoteFolder | undefined>(remoteFolderList[0]);

    const updateSelectedConnection = (connection: RemoteConnection) => {
        remote.persistentState.selectedConnection = connection;
        setRemoteFolders(remote.persistentState.getSavedRemoteReports(connection));
        setSelectedRemoteFolder(remote.persistentState.getSavedRemoteReports(connection)[0]);
    };

    const updateSavedRemoteFolders = (connection: RemoteConnection | undefined, updatedFolders: RemoteFolder[]) => {
        if (!connection) {
            return [];
        }

        const savedFolders = remote.persistentState.getSavedRemoteReports(connection);
        const mergedFolders = (updatedFolders ?? []).map((updatedFolder) => {
            const existingFolder = savedFolders?.find((f) => f.localPath === updatedFolder.localPath);

            return {
                ...existingFolder,
                ...updatedFolder,
            } as RemoteFolder;
        });

        remote.persistentState.setSavedRemoteReports(connection, mergedFolders);
        setRemoteFolders(mergedFolders);

        return mergedFolders;
    };

    const findConnectionIndex = (connection?: RemoteConnection) => {
        return remote.persistentState.savedConnectionList.findIndex((c) => {
            const isSameName = c.name === connection?.name;
            const isSameHost = c.host === connection?.host;
            const isSamePort = c.port === connection?.port;

            return isSameName && isSameHost && isSamePort;
        });
    };

    const viewReport = async () => {
        if (remote.persistentState.selectedConnection && selectedRemoteFolder) {
            const response = await remote.mountRemoteReport(
                remote.persistentState.selectedConnection,
                selectedRemoteFolder,
            );

            if (response.status === 200) {
                queryClient.clear();
                setReportLocation('remote');
                navigate(ROUTES.OPERATIONS);
            }
        }
    };

    const isUsingRemoteQuerying = remote.persistentState.selectedConnection?.useRemoteQuerying;

    const isRemoteReportMounted =
        !isSyncingRemoteFolder &&
        !isLoadingFolderList &&
        remoteFolderList?.length > 0 &&
        selectedRemoteFolder &&
        !isRemoteFolderOutdated(selectedRemoteFolder) &&
        reportLocation === 'remote';

    useEffect(() => {
        (async () => {
            try {
                setIsFetchingFolderStatus(true);
                const updatedRemoteFolders = await remote.listRemoteReports(remote.persistentState.selectedConnection);

                setIsRemoteOffline(false);
                updateSavedRemoteFolders(remote.persistentState.selectedConnection!, updatedRemoteFolders);
            } catch {
                setIsRemoteOffline(true);
            } finally {
                setIsFetchingFolderStatus(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            <FormGroup
                label={<h3>Add remote sync server</h3>}
                labelFor='text-input'
                subLabel='Add new server connection details'
            >
                <AddRemoteConnection
                    disabled={isLoadingFolderList || isSyncingRemoteFolder}
                    onAddConnection={(newConnection) => {
                        remote.persistentState.savedConnectionList = [
                            ...remote.persistentState.savedConnectionList,
                            newConnection,
                        ];

                        updateSelectedConnection(newConnection);
                    }}
                />
            </FormGroup>

            <FormGroup
                label={<h3>Use remote sync server</h3>}
                labelFor='text-input'
                subLabel='Select remote server that will be used for syncing folders'
            >
                <RemoteConnectionSelector
                    connection={remote.persistentState.selectedConnection}
                    connectionList={remote.persistentState.savedConnectionList}
                    disabled={isLoadingFolderList || isSyncingRemoteFolder}
                    loading={isLoadingFolderList}
                    offline={isRemoteOffline}
                    onEditConnection={(updatedConnection, oldConnection) => {
                        const updatedConnections = [...remote.persistentState.savedConnectionList];

                        updatedConnections[findConnectionIndex(oldConnection)] = updatedConnection;
                        remote.persistentState.savedConnectionList = updatedConnections;
                        remote.persistentState.updateSavedRemoteFoldersConnection(oldConnection, updatedConnection);

                        updateSelectedConnection(updatedConnection);
                    }}
                    onRemoveConnection={(connection) => {
                        const updatedConnections = [...remote.persistentState.savedConnectionList];

                        updatedConnections.splice(findConnectionIndex(connection), 1);
                        remote.persistentState.savedConnectionList = updatedConnections;
                        remote.persistentState.deleteSavedRemoteReports(connection);

                        updateSelectedConnection(updatedConnections[0]);
                        setSelectedRemoteFolder(undefined);
                    }}
                    onSelectConnection={async (connection) => {
                        try {
                            setIsFetchingFolderStatus(true);
                            updateSelectedConnection(connection);

                            const fetchedRemoteFolders = await remote.listRemoteReports(connection);
                            const updatedFolders = updateSavedRemoteFolders(connection, fetchedRemoteFolders);

                            setIsRemoteOffline(false);
                            setSelectedRemoteFolder(updatedFolders[0]);
                        } catch {
                            setIsRemoteOffline(true);
                        } finally {
                            setIsFetchingFolderStatus(false);
                        }
                    }}
                    onSyncRemoteFolderList={async () => {
                        try {
                            setIsLoadingFolderList(true);

                            const savedRemotefolders = await remote.listRemoteReports(
                                remote.persistentState.selectedConnection,
                            );

                            const updatedfolders = updateSavedRemoteFolders(
                                remote.persistentState.selectedConnection,
                                savedRemotefolders,
                            );

                            setSelectedRemoteFolder(updatedfolders[0]);
                        } catch (err) {
                            // eslint-disable-next-line no-alert
                            alert('Unable to connect to remote server.');
                        } finally {
                            setIsLoadingFolderList(false);
                        }
                    }}
                />
            </FormGroup>

            <FormGroup
                label={<h3>Select remote folder</h3>}
                labelFor='text-input'
                subLabel='Select folder to sync data from'
            >
                <RemoteFolderSelector
                    remoteFolder={selectedRemoteFolder}
                    remoteFolderList={remoteFolderList}
                    loading={isSyncingRemoteFolder || isLoadingFolderList}
                    updatingFolderList={isFetchingFolderStatus}
                    onSelectFolder={(folder) => {
                        setSelectedRemoteFolder(folder);
                    }}
                >
                    <Tooltip content='Sync remote folder'>
                        <AnchorButton
                            icon={IconNames.REFRESH}
                            loading={isSyncingRemoteFolder}
                            disabled={
                                isSyncingRemoteFolder ||
                                isUsingRemoteQuerying ||
                                isLoadingFolderList ||
                                !selectedRemoteFolder ||
                                remoteFolderList?.length === 0
                            }
                            onClick={async () => {
                                try {
                                    setIsSyncingRemoteFolder(true);
                                    const { data: updatedFolder } = await remote.syncRemoteReport(
                                        remote.persistentState.selectedConnection,
                                        selectedRemoteFolder,
                                    );

                                    const savedRemoteFolders = remote.persistentState.getSavedRemoteReports(
                                        remote.persistentState.selectedConnection,
                                    );

                                    const updatedFolderIndex = savedRemoteFolders.findIndex(
                                        (f) => f.localPath === selectedRemoteFolder?.localPath,
                                    );

                                    savedRemoteFolders[updatedFolderIndex] = updatedFolder;

                                    updateSavedRemoteFolders(
                                        remote.persistentState.selectedConnection,
                                        savedRemoteFolders,
                                    );

                                    setSelectedRemoteFolder(selectedRemoteFolder);
                                } catch {
                                    // eslint-disable-next-line no-alert
                                    alert('Unable to sync remote folder');
                                } finally {
                                    setIsSyncingRemoteFolder(false);
                                    setReportLocation('remote');
                                }
                            }}
                        />
                    </Tooltip>

                    <Button
                        disabled={!isUsingRemoteQuerying && !isRemoteReportMounted}
                        onClick={viewReport}
                        icon={IconNames.EYE_OPEN}
                    >
                        View report
                    </Button>
                </RemoteFolderSelector>
            </FormGroup>
        </>
    );
};

export default RemoteSyncConfigurator;
