// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';
import { useState } from 'react';

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

        return axios
            .post(`${import.meta.env.VITE_API_ROOT}/local/upload`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                onUploadProgress(uploadStatus) {
                    setUploadProgress({
                        progress: uploadStatus.progress,
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
