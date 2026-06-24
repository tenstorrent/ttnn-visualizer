// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState } from 'react';
import { useAtom, useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import { FileInput, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import useMlirRemote from '../../hooks/useMlirRemote';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { MLIR_SERVER_ACCEPTED_EXTENSIONS, MlirServerConnection } from '../../definitions/MlirServer';
import ROUTES from '../../definitions/Routes';
import { activeMlirDataAtom, activeMlirJsonAtom } from '../../store/app';
import { GraphBundle } from '../../model/MLIRJsonModel';
import createToastNotification, { ToastType } from '../../functions/createToastNotification';
import getResponseError from '../../functions/getResponseError';
import sanitiseFileName from '../../functions/sanitiseFileName';
import 'styles/components/FileLoader.scss';

const ICON_MAP: Record<ConnectionTestStates, IconName> = {
    [ConnectionTestStates.IDLE]: IconNames.DOT,
    [ConnectionTestStates.PROGRESS]: IconNames.DOT,
    [ConnectionTestStates.FAILED]: IconNames.CROSS,
    [ConnectionTestStates.OK]: IconNames.TICK,
    [ConnectionTestStates.WARNING]: IconNames.WARNING_SIGN,
};

const INTENT_MAP: Record<ConnectionTestStates, Intent> = {
    [ConnectionTestStates.IDLE]: Intent.NONE,
    [ConnectionTestStates.PROGRESS]: Intent.WARNING,
    [ConnectionTestStates.FAILED]: Intent.DANGER,
    [ConnectionTestStates.OK]: Intent.SUCCESS,
    [ConnectionTestStates.WARNING]: Intent.WARNING,
};

interface MlirJsonFileLoaderProps {
    server?: MlirServerConnection | null;
}

const MlirJsonFileLoader = ({ server = null }: MlirJsonFileLoaderProps) => {
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { uploadMlirFileToServer } = useMlirRemote();
    const navigate = useNavigate();
    const location = useLocation();
    const [mlirJsonFileName, setMlirJsonFileName] = useAtom(activeMlirJsonAtom);
    const setActiveMlirData = useSetAtom(activeMlirDataAtom);
    const [uploadStatus, setUploadStatus] = useState<ConnectionTestStates>(ConnectionTestStates.IDLE);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        // Guard *before* mutating state so cancelling the OS file dialog
        // (which fires `change` with an empty `files` list) leaves the
        // component in its previous state instead of stuck at PROGRESS.
        if (!event.target.files?.length) {
            return;
        }

        // Server uploads report progress through the shared FileStatusOverlay
        // and success through a toast, so the inline status is only used for
        // local JSON loads (no overlay) and for surfacing upload failures.
        if (server) {
            setUploadStatus(ConnectionTestStates.IDLE);
            setErrorMessage(null);
        } else {
            setErrorMessage('Loading...');
            setUploadStatus(ConnectionTestStates.PROGRESS);
        }

        const file = event.target.files[0];

        try {
            let graph: GraphBundle | null;
            // Persisted report name the backend stored in the instance, so a
            // reload restores the same name. Falls back to the local filename
            // for the client-side load (no backend round-trip).
            let reportName: string;

            if (server) {
                const response = await uploadMlirFileToServer(event.target.files, server);

                if (response?.data?.status !== ConnectionTestStates.OK) {
                    setUploadStatus(ConnectionTestStates.FAILED);
                    setErrorMessage(response?.data?.message ?? 'Upload failed');
                    return;
                }

                graph = response.data.graph ?? null;
                reportName = response.data.name ?? sanitiseFileName(file.name);
            } else {
                // Load an already-processed MLIR JSON straight into the viewer,
                // bypassing the Model Explorer conversion backend.
                graph = JSON.parse(await file.text()) as GraphBundle;
                reportName = sanitiseFileName(file.name);
            }

            setActiveMlirData(graph);
            setMlirJsonFileName(reportName);
            createToastNotification('MLIR', file.name, ToastType.SUCCESS);

            // Uploads surface success via the toast above; only the local-load
            // path shows it inline.
            if (!server) {
                setUploadStatus(ConnectionTestStates.OK);
                setErrorMessage(`${file.name} loaded successfully`);
            }

            if (graph && location.pathname !== ROUTES.MLIR) {
                navigate(ROUTES.MLIR);
            }
        } catch (err: unknown) {
            setUploadStatus(ConnectionTestStates.FAILED);
            setErrorMessage(getResponseError(err, server ? 'Unable to upload MLIR file' : 'Unable to load MLIR file'));
        }
    };

    const acceptedExtensions = server ? MLIR_SERVER_ACCEPTED_EXTENSIONS.join(',') : '.json';
    const placeholder = server ? 'Upload a model file' : 'Upload an MLIR JSON';

    return (
        <div className='file-loader'>
            <FileInput
                text={mlirJsonFileName ?? placeholder}
                onInputChange={handleFileChange}
                inputProps={{ accept: acceptedExtensions }}
            />

            <div className={`verify-connection-item status-${ConnectionTestStates[uploadStatus]}`}>
                {uploadStatus ? (
                    <>
                        <Icon
                            className='connection-status-icon'
                            icon={ICON_MAP[uploadStatus]}
                            size={20}
                            intent={INTENT_MAP[uploadStatus]}
                        />

                        <span className='connection-status-text'>{errorMessage}</span>
                    </>
                ) : null}
            </div>
        </div>
    );
};

export default MlirJsonFileLoader;
