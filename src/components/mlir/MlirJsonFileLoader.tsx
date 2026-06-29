// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Button, ButtonVariant, FileInput, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import useMlirRemote from '../../hooks/useMlirRemote';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { MLIR_SERVER_ACCEPTED_EXTENSIONS, MlirServerConnection } from '../../definitions/MlirServer';
import { activeMlirJsonAtom, mlirFileResultsAtom, mlirFileResultsOpenAtom } from '../../store/app';
import { GraphBundle, MlirFileResult } from '../../model/MLIRJsonModel';
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
    const mlirJsonFileName = useAtomValue(activeMlirJsonAtom);
    const [mlirFileResults, setMlirFileResults] = useAtom(mlirFileResultsAtom);
    const setMlirFileResultsOpen = useSetAtom(mlirFileResultsOpenAtom);
    const [uploadStatus, setUploadStatus] = useState<ConnectionTestStates>(ConnectionTestStates.IDLE);

    // Publish a fresh batch of results and open the overlay.
    const showResults = (results: MlirFileResult[]) => {
        setMlirFileResults(results);
        setMlirFileResultsOpen(true);
    };

    // Parse already-processed MLIR JSON files in the browser, bypassing the
    // Model Explorer conversion backend. Each file is parsed independently so
    // one malformed file doesn't sink the rest.
    const loadLocalFiles = async (files: FileList): Promise<MlirFileResult[]> =>
        Promise.all(
            Array.from(files).map(async (file): Promise<MlirFileResult> => {
                try {
                    const graph = JSON.parse(await file.text()) as GraphBundle;
                    return {
                        filename: file.name,
                        name: sanitiseFileName(file.name),
                        status: ConnectionTestStates.OK,
                        graph,
                        persisted: false,
                    };
                } catch {
                    return {
                        filename: file.name,
                        name: null,
                        status: ConnectionTestStates.FAILED,
                        message: 'Invalid MLIR JSON',
                        graph: null,
                        persisted: false,
                    };
                }
            }),
        );

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        // Guard *before* mutating state so cancelling the OS file dialog
        // (which fires `change` with an empty `files` list) leaves the
        // component in its previous state.
        if (!event.target.files?.length) {
            return;
        }

        // The inline status only surfaces whole-batch failures; per-file
        // outcomes and the active-file choice are handled in the results
        // overlay driven by `mlirFileResultsAtom`.
        setUploadStatus(ConnectionTestStates.IDLE);
        setErrorMessage(null);

        const { files } = event.target;

        try {
            if (server) {
                // Files upload as one batch then convert in parallel on the
                // server. Publish a pending row per file (without opening the
                // results overlay) so the processing overlay can show each file
                // with a spinner; replaced with outcomes once the request
                // resolves.
                setMlirFileResults(
                    Array.from(files).map((file) => ({
                        filename: file.name,
                        name: null,
                        status: ConnectionTestStates.PROGRESS,
                        graph: null,
                        persisted: true,
                    })),
                );

                // Server uploads report transfer progress through the shared
                // FileStatusOverlay; the results overlay opens once converted.
                const response = await uploadMlirFileToServer(files, server);
                const results: MlirFileResult[] = (response?.data?.results ?? []).map((result) => ({
                    filename: result.filename,
                    name: result.name,
                    status: result.status,
                    message: result.message,
                    graph: result.graph ?? null,
                    persisted: true,
                }));

                if (!results.length) {
                    setUploadStatus(ConnectionTestStates.FAILED);
                    setErrorMessage('Upload failed');
                    return;
                }

                showResults(results);
            } else {
                showResults(await loadLocalFiles(files));
            }
        } catch (err: unknown) {
            setUploadStatus(ConnectionTestStates.FAILED);
            setErrorMessage(getResponseError(err, server ? 'Unable to upload MLIR file' : 'Unable to load MLIR file'));
        }
    };

    const acceptedExtensions = server ? MLIR_SERVER_ACCEPTED_EXTENSIONS.join(',') : '.json';
    const placeholder = server ? 'Upload model files' : 'Upload MLIR JSON files';

    return (
        <div className='file-loader'>
            <FileInput
                text={mlirJsonFileName ?? placeholder}
                onInputChange={handleFileChange}
                inputProps={{ accept: acceptedExtensions, multiple: true }}
            />

            <Button
                variant={ButtonVariant.OUTLINED}
                intent={Intent.PRIMARY}
                icon={IconNames.LIST}
                text='View MLIR uploads'
                onClick={() => setMlirFileResultsOpen(true)}
                disabled={!mlirFileResults || !(mlirFileResults?.length > 0)}
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
