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

    const uploadUrl = `${import.meta.env.VITE_API_ROOT}/local/upload`;
    const uploadLocalFolder = async (files: FileList) => {
        const formData = new FormData();
        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        // Return a Promise that resolves with the final message after all files are uploaded
        return axiosInstance.post(uploadUrl, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            responseType: 'stream', // Enable streaming response
        });
    };

    return {
        uploadLocalFolder,
        uploadProgress,
    };
};

export default useLocalConnection;
