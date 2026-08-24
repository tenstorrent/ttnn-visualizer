// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { AxiosError, AxiosResponse } from 'axios';
import axiosInstance from '../libs/axiosInstance';
import { FileTransferSource } from '../definitions/FileTransferSource';
import {
    clearFileTransferProgressForSource,
    getInactiveFileTransferProgress,
    setFileTransferProgressForSource,
} from '../store/fileTransferRegistry';
import { FileStatus } from '../model/APIData';
import Endpoints from '../definitions/Endpoints';
import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';
import { MlirServerConnection } from '../model/MlirServer';
import { GraphBundle } from '../model/MLIRJsonModel';
import getResponseError from '../functions/getResponseError';

// One per uploaded file. `name` and `graph` are populated only when the file
// converted successfully; on failure they are null and `message` explains why.
export interface MlirFileUploadResult {
    status: ConnectionTestStates;
    message?: string;
    detail?: string;
    filename: string;
    host?: string | null;
    name: string | null;
    graph: GraphBundle | null;
}

export interface MlirUploadResponse {
    results: MlirFileUploadResult[];
}

/**
 * Options for controlling MLIR file upload behaviour.
 */
export interface MlirUploadOptions {
    /**
     * Abort signal for cancellation. When aborted, the request is cancelled
     * and axios rejects with a cancel error. Callers must handle axios.isCancel(err)
     * to distinguish user-triggered aborts from genuine errors.
     */
    signal?: AbortSignal;
    /**
     * Suppress the global FileStatusOverlay during this upload. Used by retry flows
     * to show per-row progress instead. Note: this is per-request and not concurrency-aware
     * (no reference counting), so parallel non-retry uploads should not use this.
     */
    suppressProgressOverlay?: boolean;
}

const useMlirRemote = () => {
    const resetTransferProgress = () => {
        clearFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD);
    };

    // Proxied through the backend over SSH (same path as the connection test):
    // the file is scp'd to the remote host and curl runs against that machine's
    // loopback MLIR port, avoiding browser CORS on a cross-origin POST.
    //
    // Drives the per-source `MLIR_UPLOAD` slot so the shared `FileStatusOverlay`
    // (also used by remote sync) reports progress. The browser→backend transfer
    // fills the bar quickly; it then sits at the final value while upload+conversion
    // runs on the remote MLIR server (which can take minutes with no further progress
    // to report) until the request resolves and `resetTransferProgress` closes the
    // overlay for this source only.
    const uploadMlirFileToServer = async (
        files: File[],
        server: MlirServerConnection,
        options?: MlirUploadOptions,
    ): Promise<AxiosResponse<MlirUploadResponse>> => {
        const formData = new FormData();

        files.forEach((f) => {
            formData.append('files', f);
        });
        formData.append('host', server.host);
        formData.append('username', server.username);
        formData.append('sshPort', server.sshPort.toString());
        formData.append('port', server.port.toString());
        formData.append('name', server.name);
        if (server.identityFile) {
            formData.append('identityFile', server.identityFile);
        }

        const fileName = files[0]?.name ?? '';
        const shouldReportProgress = !options?.suppressProgressOverlay;

        // Open the overlay immediately: the remote conversion can run for some
        // time before the first upload-progress event, so don't wait for it.
        if (shouldReportProgress) {
            setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, {
                ...getInactiveFileTransferProgress(),
                numberOfFiles: files.length,
                currentFileName: fileName,
                status: FileStatus.UPLOADING,
            });
        }

        try {
            return await axiosInstance.post<MlirUploadResponse>(`${Endpoints.REMOTE}/mlir/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                signal: options?.signal,
                onUploadProgress: (event) => {
                    if (!shouldReportProgress) {
                        return;
                    }

                    if (!event || event.total === null || event.total === undefined || event.total <= 0) {
                        return;
                    }
                    const uploadComplete = event.loaded >= event.total;
                    setFileTransferProgressForSource(FileTransferSource.MLIR_UPLOAD, {
                        ...getInactiveFileTransferProgress(),
                        numberOfFiles: files.length,
                        currentFileName: fileName,
                        percentOfCurrent: Math.round((event.loaded * 100) / event.total),
                        bytesTransferred: event.loaded,
                        bytesTotal: event.total,
                        // Once all bytes are sent, the remote MLIR server is
                        // converting the file — switch to the indeterminate
                        // processing stage until the request resolves.
                        status: uploadComplete ? FileStatus.PROCESSING : FileStatus.UPLOADING,
                    });
                },
            });
        } finally {
            if (shouldReportProgress) {
                resetTransferProgress();
            }
        }
    };

    // The MLIR server listens on the remote host's loopback, so reachability can only be
    // checked server-side: the backend SSHes to the host and curls the endpoint there.
    const testMlirServerConnection = async (server: MlirServerConnection): Promise<ConnectionStatus[]> => {
        try {
            const { data } = await axiosInstance.post<ConnectionStatus[]>(`${Endpoints.REMOTE}/mlir/test`, server);
            return data;
        } catch (err: unknown) {
            const axiosError = err as AxiosError;

            if (Array.isArray(axiosError.response?.data)) {
                return axiosError.response.data;
            }

            return [{ status: ConnectionTestStates.FAILED, message: getResponseError(err, 'Connection test failed') }];
        }
    };

    // Persist which uploaded MLIR report is active on the instance so `/mlir`
    // serves it and a reload restores the same selection. Server uploads store
    // each converted graph as `<name>.json`; this records the chosen one.
    const setActiveMlir = async (name: string, host?: string | null): Promise<void> => {
        await axiosInstance.post(`${Endpoints.MLIR}/active`, host ? { name, host } : { name });
    };

    return {
        uploadMlirFileToServer,
        testMlirServerConnection,
        setActiveMlir,
    };
};

export default useMlirRemote;
