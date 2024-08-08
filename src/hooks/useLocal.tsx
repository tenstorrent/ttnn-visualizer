// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';
import { FileWithDirectoryAndFileHandle } from 'browser-fs-access';

export interface LocalFile extends FileWithDirectoryAndFileHandle {
    webkitRelativePath: string;
}

const useLocalConnection = () => {
    const uploadLocalFolder = async (files: FileList) => {
        const formData = new FormData();
        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        return axios.post(`${import.meta.env.VITE_API_ROOT}/local/upload`, formData, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });
    };

    return {
        uploadLocalFolder,
    };
};

export default useLocalConnection;
