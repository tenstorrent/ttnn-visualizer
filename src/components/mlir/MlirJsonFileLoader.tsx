// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { Button, ButtonVariant, FileInput, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import useMlirRemote from '../../hooks/useMlirRemote';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { MLIR_SERVER_ACCEPTED_EXTENSIONS } from '../../definitions/MlirServer';
import { MlirServerConnection } from '../../model/MlirServer';
import {
    activeMlirJsonAtom,
    mlirFileResultsAtom,
    mlirFileResultsOpenAtom,
    mlirLoadedReportsAtom,
    mlirRetryFilesAtom,
} from '../../store/app';
import { GraphBundle, MlirFileResult } from '../../model/MLIRJsonModel';
import getResponseError from '../../functions/getResponseError';
import sanitiseFileName from '../../functions/sanitiseFileName';
import mapConvertedMlirServerResult from '../../functions/mapConvertedMlirServerResult';
import relabelMlirGraphIds from '../../functions/relabelMlirGraphIds';
import uniqueMlirName from '../../functions/uniqueMlirName';
import { ReportKind, ReportLoadFailureReason } from '../../definitions/UsageEvent';
import { getReportLoadFailureReason, recordReportLoadFailed } from '../../functions/reportLoadUsage';
import { MLIRValidationError, MLIR_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR } from '../../definitions/MLIRData';
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
    /** When true, the file input cannot open or change selection. */
    disabled?: boolean;
}

const MlirJsonFileLoader = ({ server = null, disabled = false }: MlirJsonFileLoaderProps) => {
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const { uploadMlirFileToServer } = useMlirRemote();
    const mlirJsonFileName = useAtomValue(activeMlirJsonAtom);
    const [mlirFileResults, setMlirFileResults] = useAtom(mlirFileResultsAtom);
    const setMlirFileResultsOpen = useSetAtom(mlirFileResultsOpenAtom);
    const setMlirRetryFiles = useSetAtom(mlirRetryFilesAtom);
    const setMlirLoadedReports = useSetAtom(mlirLoadedReportsAtom);
    const [uploadStatus, setUploadStatus] = useState<ConnectionTestStates>(ConnectionTestStates.IDLE);

    // Drop split peers on a new results batch so a stale second report cannot
    // linger under a previous primary. Keep index 0 if present.
    const clearSplitPeers = () => {
        setMlirLoadedReports((current) => current.slice(0, 1));
    };

    // Publish a fresh batch of results and open the overlay.
    const showResults = (results: MlirFileResult[]) => {
        clearSplitPeers();
        setMlirFileResults(results);
        setMlirFileResultsOpen(true);
    };

    // Parse already-processed MLIR JSON files in the browser, bypassing the
    // Model Explorer conversion backend. Each file is parsed independently so
    // one malformed file doesn't sink the rest.
    const loadLocalFiles = async (files: FileList): Promise<MlirFileResult[]> => {
        // Pre-assign unique names synchronously before starting async I/O so
        // the within-batch de-duplication mirrors the backend `_unique_mlir_name`
        // scheme: first file keeps the stem, subsequent same-stem files become
        // `stem (2)`, `stem (3)`, …  Name assignment must run before the async
        // reads to guarantee ordering even when multiple awaits are in flight.
        const usedNames = new Set<string>();
        const names = Array.from(files).map((file) => uniqueMlirName(sanitiseFileName(file.name), usedNames));

        return Promise.all(
            Array.from(files).map(async (file, index): Promise<MlirFileResult> => {
                const name = names[index];
                try {
                    const graph = JSON.parse(await file.text()) as GraphBundle;
                    return {
                        filename: file.name,
                        name,
                        status: ConnectionTestStates.OK,
                        graph: relabelMlirGraphIds(graph, name),
                        persisted: false,
                    };
                } catch {
                    recordReportLoadFailed(
                        ReportKind.MLIR,
                        MLIR_LOAD_FAILURE_REASON_BY_VALIDATION_ERROR[MLIRValidationError.INVALID_JSON],
                    );
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
    };

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
        setStatusMessage(null);

        const { files } = event.target;
        const selectedFiles = Array.from(files);

        try {
            if (server) {
                setMlirRetryFiles(selectedFiles);

                // Files upload as one batch then convert in parallel on the
                // server. Publish a pending row per file (without opening the
                // results overlay) so the processing overlay can show each file
                // with a spinner; replaced with outcomes once the request
                // resolves.
                clearSplitPeers();
                setMlirFileResults(
                    selectedFiles.map((file) => ({
                        filename: file.name,
                        host: server.host,
                        name: null,
                        status: ConnectionTestStates.PROGRESS,
                        graph: null,
                        persisted: true,
                    })),
                );

                // Server uploads report transfer progress through the shared
                // FileStatusOverlay; the results overlay opens once converted.
                const response = await uploadMlirFileToServer(selectedFiles, server);
                const results: MlirFileResult[] = (response?.data?.results ?? []).map((result) =>
                    mapConvertedMlirServerResult(result, server.host),
                );

                if (!results.length) {
                    // Drop the pending spinner rows so they don't linger as
                    // permanently-converting entries behind the View button.
                    setMlirFileResults(null);
                    setMlirRetryFiles(null);
                    setUploadStatus(ConnectionTestStates.FAILED);
                    setStatusMessage('Upload failed');
                    selectedFiles.forEach(() => recordReportLoadFailed(ReportKind.MLIR, ReportLoadFailureReason.OTHER));
                    return;
                }

                // Retry is only meaningful when at least one server file
                // failed conversion. Clear retained File blobs after all-
                // success batches to avoid unnecessary memory retention.
                const hasRetryableFailures = results.some((result) => result.status === ConnectionTestStates.FAILED);
                results.forEach((result) => {
                    if (result.status === ConnectionTestStates.FAILED) {
                        recordReportLoadFailed(ReportKind.MLIR, ReportLoadFailureReason.OTHER);
                    }
                });
                if (!hasRetryableFailures) {
                    setMlirRetryFiles(null);
                }

                showResults(results);
            } else {
                setMlirRetryFiles(null);
                showResults(await loadLocalFiles(files));
            }
        } catch (err: unknown) {
            // Drop any pending spinner rows so a failed upload doesn't leave
            // permanently-converting entries behind the View button.
            setMlirFileResults(null);
            setMlirRetryFiles(null);
            setUploadStatus(ConnectionTestStates.FAILED);
            setStatusMessage(getResponseError(err, server ? 'Unable to upload MLIR file' : 'Unable to load MLIR file'));
            selectedFiles.forEach(() => recordReportLoadFailed(ReportKind.MLIR, getReportLoadFailureReason(err)));
        }
    };

    const acceptedExtensions = server ? MLIR_SERVER_ACCEPTED_EXTENSIONS.join(',') : '.json';
    const placeholder = server ? 'Upload model files' : 'Upload MLIR JSON files';
    const hasSettledResults = !!mlirFileResults?.some((result) => result.status !== ConnectionTestStates.PROGRESS);

    return (
        <div className='file-loader'>
            <FileInput
                text={mlirJsonFileName ?? placeholder}
                onInputChange={handleFileChange}
                disabled={disabled}
                inputProps={{ accept: acceptedExtensions, multiple: true }}
            />

            <Button
                variant={ButtonVariant.OUTLINED}
                intent={Intent.PRIMARY}
                icon={IconNames.LIST}
                text='View MLIR uploads'
                onClick={() => setMlirFileResultsOpen(true)}
                disabled={disabled || !hasSettledResults}
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

                        <span className='connection-status-text'>{statusMessage}</span>
                    </>
                ) : null}
            </div>
        </div>
    );
};

export default MlirJsonFileLoader;
