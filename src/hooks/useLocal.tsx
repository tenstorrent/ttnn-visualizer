// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { useState } from 'react';
import axiosInstance from '../libs/axiosInstance';

export interface UploadProgress {
    progress?: number;
    estimated?: number;
}

type FileWithRelativePath = File & { webkitRelativePath?: string };

const useLocalConnection = () => {
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

    function filterReportFiles(files: FileList, excludeFolders: string[] = ['tensors']): FileList {
        // Convert FileList to an array
        const fileArray = Array.from(files) as FileWithRelativePath[];

        // Filter out files in the excluded folders
        const filteredFiles = fileArray.filter((file) => {
            return !excludeFolders.some((folder) => file.webkitRelativePath?.includes(`/${folder}/`));
        });

        // Create a new DataTransfer object to hold the filtered files
        const dataTransfer = new DataTransfer();
        filteredFiles.forEach((file) => dataTransfer.items.add(file));

        // Return the filtered files as a FileList
        return dataTransfer.files;
    }

    const checkRequiredFiles = (files: FileList): boolean => {
        const requiredFiles = ['db.sqlite', 'config.json'];
        const fileSet = new Set<string>();

        Array.from(files).forEach((file) => {
            const pathParts = file.webkitRelativePath.split('/');
            if (pathParts.length === 2) {
                fileSet.add(pathParts[1]);
            }
        });

        return requiredFiles.every((file) => fileSet.has(file));
    };

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
            .catch((error) => error)
            .finally(() => {
                setUploadProgress(null);
            });
    };

    const uploadLocalPerformanceFolder = async (files: FileList) => {
        const formData = new FormData();
        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        return axiosInstance
            .post(`${import.meta.env.VITE_API_ROOT}/local/upload/profile`, formData, {
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
            .catch((error) => error)
            .finally(() => {
                setUploadProgress(null);
            });
    };

    return {
        checkRequiredFiles,
        uploadLocalFolder,
        uploadProgress,
        uploadLocalPerformanceFolder,
        filterReportFiles,
    };
};

export default useLocalConnection;
