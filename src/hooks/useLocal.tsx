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

const ua = navigator.userAgent.toLowerCase();
const IS_SAFARI = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android');

const useLocalConnection = () => {
    /**
     * Retrieves the top level folder name from an array of uploaded files
     * @param files
     */
    function getUploadedFolderName(files: FileList): string | null {
        const fileArray = Array.from(files) as FileWithRelativePath[];
        const relativePaths = fileArray.map((file) => file.webkitRelativePath);

        if (relativePaths.length === 0) {
            return null;
        }

        // Find the common root folder
        const commonPath = relativePaths.reduce((common, path) => {
            const commonSegments = common.split('/').filter((segment, index) => segment === path.split('/')[index]);
            return commonSegments.join('/');
        });

        const folderSegments = commonPath.split('/');
        return folderSegments.length >= 1 ? folderSegments[folderSegments.length - 1] : null;
    }

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

    const checkRequiredProfilerFiles = (files: FileList): boolean => {
        // Required profiler files, including a pattern for `ops_perf_results`
        const requiredFiles = ['profile_log_device.csv', 'tracy_profile_log_host.tracy'];
        const opsPerfPrefix = 'ops_perf_results';

        const fileSet = new Set<string>();

        Array.from(files).forEach((file) => {
            const pathParts = file.webkitRelativePath.split('/');
            if (pathParts.length === 2) {
                fileSet.add(pathParts[1]);
            }
        });

        // Ensure all required files are present
        const hasRequiredFiles = requiredFiles.every((file) => fileSet.has(file));

        // Check for at least one `ops_perf_results` file
        const hasOpsPerfFile = Array.from(fileSet).some((fileName) => fileName.startsWith(opsPerfPrefix));

        return hasRequiredFiles && hasOpsPerfFile;
    };

    const checkRequiredReportFiles = (files: FileList): boolean => {
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

        // In the POST request Safari seems to remove the parent folder name so we're adding it specifically here
        if (IS_SAFARI) {
            formData.append('folderName', files[0].webkitRelativePath.split('/')[0]);
        }

        return axiosInstance
            .post('/local/upload/profiler', formData, {
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

        // In the POST request Safari seems to remove the parent folder name so we're adding it specifically here
        if (IS_SAFARI) {
            formData.append('folderName', files[0].webkitRelativePath.split('/')[0]);
        }

        return axiosInstance
            .post('/local/upload/performance', formData, {
                headers: {
                    'Content-Type': 'multipart/form-data',
                },

                onUploadProgress: (event: AxiosProgressEvent) => {
                    if (event && event.total !== null && event.total !== undefined) {
                        const progress = Math.round((event.loaded * 100) / event.total);
                        store.set(fileTransferProgressAtom, {
                            percentOfCurrent: progress,
                            currentFileName: '',
                            finishedFiles: 0,
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

    const uploadNpeFile = async (files: FileList) => {
        const store = getDefaultStore();
        const formData = new FormData();

        Array.from(files).forEach((f) => {
            formData.append('files', f);
        });

        return axiosInstance
            .post('/local/upload/npe', formData, {
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
        getUploadedFolderName,
        checkRequiredReportFiles,
        checkRequiredProfilerFiles,
        uploadLocalFolder,
        uploadLocalPerformanceFolder,
        uploadNpeFile,
        filterReportFiles,
    };
};

export default useLocalConnection;
