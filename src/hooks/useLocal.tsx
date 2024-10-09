// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState } from 'react';
import axiosInstance from '../libs/axiosInstance';

export interface UploadProgress {
    progress?: number;
    estimated?: number;
}

const useLocalConnection = () => {
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

    const uploadLocalFolder = async (files: FileList) => {
        const formData = new FormData();
        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        return axiosInstance
            .post(`${import.meta.env.VITE_API_ROOT}/local/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                onUploadProgress(uploadStatus) {
                    setUploadProgress({
                        // uploadStatus.total could be zero with certain requests, but it's not a problem at the moment for us
                        // https://github.com/axios/axios/issues/1591
                        progress: (uploadStatus.loaded * 100) / uploadStatus.total!,
                        estimated: uploadStatus.estimated,
                    });
                },
            })
            .finally(() => {
                setUploadProgress(null);
            });
    };

    return {
        uploadLocalFolder,
        uploadProgress,
    };
};

export default useLocalConnection;
