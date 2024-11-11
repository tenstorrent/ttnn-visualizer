// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axiosInstance from '../libs/axiosInstance';
import { MountRemoteFolder } from '../definitions/RemoteConnection';

export interface UploadProgress {
    progress?: number;
    estimated?: number;
}

const useLocalConnection = () => {
    const mountLocalFolder = async ({ reportFolder }: { reportFolder: string }) => {
        return axiosInstance.post<MountRemoteFolder>(`${import.meta.env.VITE_API_ROOT}/local/use`, {
            reportFolder,
        });
    };

    return {
        mountLocalFolder,
    };
};

export default useLocalConnection;
