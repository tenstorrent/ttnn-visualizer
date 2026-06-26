// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { getDefaultStore } from 'jotai';
import { AxiosError, AxiosResponse } from 'axios';
import axiosInstance from '../libs/axiosInstance';
import { fileTransferProgressAtom, getInactiveFileTransferProgress } from '../store/app';
import { FileStatus } from '../model/APIData';
import Endpoints from '../definitions/Endpoints';
import { ConnectionStatus, ConnectionTestStates } from '../definitions/ConnectionStatus';
import { MlirServerConnection } from '../definitions/MlirServer';
import { GraphBundle } from '../model/MLIRJsonModel';
import getResponseError from '../functions/getResponseError';

export interface MlirUploadResponse {
    status: ConnectionTestStates;
    message?: string;
    detail?: string;
    name?: string;
    graph?: GraphBundle;
}

const useMlirRemote = () => {
    const resetTransferProgress = () => {
        getDefaultStore().set(fileTransferProgressAtom, getInactiveFileTransferProgress());
    };

    // Proxied through the backend over SSH (same path as the connection test):
    // the file is scp'd to the remote host and curl runs against that machine's
    // loopback MLIR port, avoiding browser CORS on a cross-origin POST.
    //
    // Drives the global `fileTransferProgressAtom` so the shared
    // `FileStatusOverlay` (also used by remote sync) reports progress. The
    // browser→backend transfer fills the bar quickly; it then sits at the final
    // value while upload+conversion runs on the remote MLIR server (which can
    // take minutes with no further progress to report) until the request
    // resolves and `resetTransferProgress` closes the overlay.
    const uploadMlirFileToServer = async (
        files: FileList,
        server: MlirServerConnection,
    ): Promise<AxiosResponse<MlirUploadResponse>> => {
        const formData = new FormData();

        Array.from(files).forEach((f) => {
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

        // Open the overlay immediately: the remote conversion can run for some
        // time before the first upload-progress event, so don't wait for it.
        getDefaultStore().set(fileTransferProgressAtom, {
            ...getInactiveFileTransferProgress(),
            numberOfFiles: files.length,
            currentFileName: fileName,
            status: FileStatus.UPLOADING,
        });

        try {
            return await axiosInstance.post<MlirUploadResponse>(`${Endpoints.REMOTE}/mlir/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                onUploadProgress: (event) => {
                    if (!event || event.total === null || event.total === undefined || event.total <= 0) {
                        return;
                    }
                    const uploadComplete = event.loaded >= event.total;
                    getDefaultStore().set(fileTransferProgressAtom, {
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
            resetTransferProgress();
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

    return {
        uploadMlirFileToServer,
        testMlirServerConnection,
    };
};

export default useMlirRemote;
