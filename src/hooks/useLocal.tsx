// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';
import { useSetAtom } from 'jotai';
import { localUploadProgressAtom } from '../store/app';

const useLocalConnection = () => {
    const setUploadProgress = useSetAtom(localUploadProgressAtom);

    const uploadLocalFolder = async (files: FileList) => {
        const formData = new FormData();
        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        return axios.post(`${import.meta.env.VITE_API_ROOT}/local/upload`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
            onUploadProgress(uploadProgress) {
                setUploadProgress({
                    progress: uploadProgress.progress,
                    estimated: uploadProgress.estimated,
                });
            },
        });
    };

    return {
        uploadLocalFolder,
    };
};

export default useLocalConnection;
