// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import axios from 'axios';
import { FileWithDirectoryAndFileHandle, directoryOpen } from 'browser-fs-access';

export interface LocalFile extends FileWithDirectoryAndFileHandle {
    webkitRelativePath: string;
}

const OPEN_FOLDER_OPTIONS = {
    recursive: false,
    id: 'projects',
};

const useLocalConnection = () => {
    const selectDirectory = async () => {
        return (await directoryOpen(OPEN_FOLDER_OPTIONS)) as LocalFile[];
    };

    const uploadLocalFolder = async (files: LocalFile[]) => {
        const response = await axios.post(`${import.meta.env.VITE_API_ROOT}/local/upload`, files, {
            headers: {
                'Content-Type': 'multipart/form-data',
            },
        });

        return response.data;
    };

    return {
        selectDirectory,
        uploadLocalFolder,
    };
};

export default useLocalConnection;
