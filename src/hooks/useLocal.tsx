// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { getDefaultStore } from 'jotai';
import { AxiosProgressEvent } from 'axios';
import axiosInstance from '../libs/axiosInstance';
import { fileTransferProgressAtom } from '../store/app';
import { FileStatus } from '../model/APIData';

export interface UploadProgress {
    progress?: number;
    estimated?: number;
}

type FileWithRelativePath = File & { webkitRelativePath?: string };

const useLocalConnection = () => {
    function filterReportFiles(files: FileList, excludeFolders: string[] = ['tensors']): FileList {
        // Convert FileList to an array
        const fileArray = Array.from(files) as FileWithRelativePath[];

        // Filter out files in the excluded folders
        const filteredFiles = fileArray.filter(
            (file) => !excludeFolders.some((folder) => file.webkitRelativePath?.includes(`/${folder}/`)),
        );

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
        const store = getDefaultStore();
        const formData = new FormData();

        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        return axiosInstance
            .post(`${import.meta.env.VITE_API_ROOT}/local/upload/report`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },
                onUploadProgress: (event: AxiosProgressEvent) => {
                    if (event && event.total !== null && event.total !== undefined) {
                        const progress = Math.round((event.loaded * 100) / event.total);
                        store.set(fileTransferProgressAtom, {
                            percentOfCurrent: progress,
                            currentFileName: '', // No filename for batch uploads; customize if needed
                            finishedFiles: 0, // Update dynamically for partial uploads if necessary
                            numberOfFiles: files.length,
                            status: FileStatus.UPLOADING,
                        });
                    }
                },
            })

            .catch((error) => error)
            .finally(() => {
                store.set(fileTransferProgressAtom, {
                    percentOfCurrent: 0,
                    currentFileName: '',
                    finishedFiles: 0,
                    numberOfFiles: files.length,
                    status: FileStatus.INACTIVE,
                });
            });
    };

    const uploadLocalPerformanceFolder = async (files: FileList) => {
        const formData = new FormData();
        const store = getDefaultStore();

        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        return axiosInstance
            .post(`${import.meta.env.VITE_API_ROOT}/local/upload/profile`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },

                onUploadProgress: (event: AxiosProgressEvent) => {
                    if (event && event.total !== null && event.total !== undefined) {
                        const progress = Math.round((event.loaded * 100) / event.total);
                        store.set(fileTransferProgressAtom, {
                            percentOfCurrent: progress,
                            currentFileName: '', // No filename for batch uploads; customize if needed
                            finishedFiles: 0, // Update dynamically for partial uploads if necessary
                            numberOfFiles: files.length,
                            status: FileStatus.UPLOADING,
                        });
                    }
                },
            })
            .catch((error) => error)
            .finally(() => {
                store.set(fileTransferProgressAtom, {
                    percentOfCurrent: 0,
                    currentFileName: '',
                    finishedFiles: 0,
                    numberOfFiles: files.length,
                    status: FileStatus.INACTIVE,
                });
            });
    };

    return {
        checkRequiredFiles,
        uploadLocalFolder,
        uploadLocalPerformanceFolder,
        filterReportFiles,
    };
};

export default useLocalConnection;
