// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, type FC, useEffect, useState } from 'react';

import 'styles/components/FolderPicker.scss';
import { useNavigate } from 'react-router';
import { useQueryClient } from 'react-query';
import { useAtom, useSetAtom } from 'jotai';
import ROUTES from '../../definitions/routes';
import useLocalConnection from '../../hooks/useLocal';
import { reportLocationAtom, selectedDeviceAtom } from '../../store/app';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import FileStatusWrapper from '../FileStatusOverlayWrapper';
import FileStatusOverlay from '../FileStatusOverlay';
import { FileStatus } from '../../model/APIData';

const ICON_MAP: Record<ConnectionTestStates, IconName> = {
    [ConnectionTestStates.IDLE]: IconNames.DOT,
    [ConnectionTestStates.PROGRESS]: IconNames.DOT,
    [ConnectionTestStates.FAILED]: IconNames.CROSS,
    [ConnectionTestStates.OK]: IconNames.TICK,
};

const INTENT_MAP: Record<ConnectionTestStates, Intent> = {
    [ConnectionTestStates.IDLE]: Intent.NONE,
    [ConnectionTestStates.PROGRESS]: Intent.WARNING,
    [ConnectionTestStates.FAILED]: Intent.DANGER,
    [ConnectionTestStates.OK]: Intent.SUCCESS,
};

const LocalFolderOptions: FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [reportLocation, setReportLocation] = useAtom(reportLocationAtom);
    const setSelectedDevice = useSetAtom(selectedDeviceAtom);

    const { uploadLocalFolder, checkRequiredFiles, filterReportFiles } = useLocalConnection();
    const [folderStatus, setFolderStatus] = useState<ConnectionStatus | undefined>();
    const [isUploading, setIsUploading] = useState(false);
    const [isUploadingPerformance, setIsPerformanceUploading] = useState(false);
    const [localUploadLabel, setLocalUploadLabel] = useState('Choose directory...');
    const [performanceFolderStatus, setPerformanceFolderStatus] = useState<ConnectionStatus | undefined>();
    const [performanceDataUploadLabel, setPerformanceDataUploadLabel] = useState('Choose directory...');

    const isLocalReportMounted = !isUploading && reportLocation === 'local';

    /**
     * This is a temporrary solution until we support Safari
     */
    const ua = navigator.userAgent.toLowerCase();
    const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android');

    const handleReportDirectoryOpen = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) {
            return;
        }

        const { files: unfilteredFiles } = e.target;
        const files = filterReportFiles(unfilteredFiles);

        const connectionStatus: ConnectionStatus = {
            status: ConnectionTestStates.OK,
            message: 'Files uploaded successfully',
        };

        const invalidReportStatus: ConnectionStatus = {
            status: ConnectionTestStates.FAILED,
            message: 'Selected directory does not contain a valid report',
        };

        if (!checkRequiredFiles(files)) {
            setFolderStatus(invalidReportStatus);
            return;
        }

        setIsUploading(true);

        setLocalUploadLabel(`${files.length} files selected.`);
        const response = await uploadLocalFolder(files);

        if (response.status !== 200) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Unable to upload selected directory.';
        }

        if (response.data.status !== ConnectionTestStates.OK) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Selected directory does not contain a valid report.';
        }

        queryClient.clear();
        setLocalUploadLabel(`${files.length} files uploaded`);
        setIsUploading(false);
        setFolderStatus(connectionStatus);
        setReportLocation('local');
    };

    const handlePerformanceDirectoryOpen = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) {
            return;
        }

        const { files: unfilteredFiles } = e.target;
        const files = filterReportFiles(unfilteredFiles);

        const connectionStatus: ConnectionStatus = {
            status: ConnectionTestStates.OK,
            message: 'Files uploaded successfully',
        };

        const invalidReportStatus: ConnectionStatus = {
            status: ConnectionTestStates.FAILED,
            message: 'Selected directory does not contain a valid report',
        };

        if (!checkRequiredFiles(files)) {
            setPerformanceFolderStatus(invalidReportStatus);
            return;
        }

        setIsPerformanceUploading(true);

        setPerformanceDataUploadLabel(`${files.length} files selected.`);
        const response = await uploadLocalFolder(files);

        if (response.status !== 200) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Unable to upload selected directory.';
        }

        if (response.data.status !== ConnectionTestStates.OK) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Selected directory does not contain a valid report.';
        }

        queryClient.clear();
        setPerformanceDataUploadLabel(`${files.length} files uploaded`);
        setIsPerformanceUploading(false);
        setPerformanceFolderStatus(connectionStatus);
        setReportLocation('local');
    };

    const viewOperation = () => {
        // keeping this here temporarily until proven otherwise
        queryClient.clear();
        setSelectedDevice(0);

        navigate(ROUTES.OPERATIONS);
    };

    useEffect(() => {
        if (isUploading) {
            setFolderStatus({
                status: ConnectionTestStates.PROGRESS,
                message: 'Files uploading...',
            });
        }

        if (isUploadingPerformance) {
            setPerformanceFolderStatus({
                status: ConnectionTestStates.PROGRESS,
                message: 'Files uploading...',
            });
        }
    }, [isUploading, isUploadingPerformance]);

    return (
        <>
            {isSafari && (
                <>
                    <h3>
                        <Icon
                            icon={IconNames.WARNING_SIGN}
                            size={20}
                            intent={Intent.WARNING}
                        />{' '}
                        This functionality is not supported in safari browser
                    </h3>
                    <p>Please use Chrome or Firefox to upload a local report </p>
                </>
            )}

            <div>
                <FormGroup
                    label={<h3>Select local files</h3>}
                    subLabel='Select a local directory containing a report'
                >
                    <div className='buttons-container'>
                        <label
                            className='bp5-file-input'
                            htmlFor='local-upload'
                        >
                            <input
                                id='local-upload'
                                type='file'
                                multiple
                                /* @ts-expect-error 'directory' does not exist on native HTMLInputElement */
                                // eslint-disable-next-line react/no-unknown-property
                                directory=''
                                webkitdirectory=''
                                disabled={isSafari}
                                onChange={handleReportDirectoryOpen}
                            />
                            <span className='bp5-file-upload-input'>{localUploadLabel}</span>
                        </label>

                        <FileStatusWrapper>
                            {(fileProgress) => (
                                <FileStatusOverlay
                                    open={
                                        isUploading ||
                                        [FileStatus.DOWNLOADING, FileStatus.COMPRESSING, FileStatus.STARTED].includes(
                                            fileProgress?.status,
                                        )
                                    }
                                    progress={fileProgress}
                                />
                            )}
                        </FileStatusWrapper>

                        {folderStatus && !isUploading && (
                            <div
                                className={`verify-connection-item status-${ConnectionTestStates[folderStatus.status]}`}
                            >
                                <Icon
                                    className='connection-status-icon'
                                    icon={ICON_MAP[folderStatus.status]}
                                    size={20}
                                    intent={INTENT_MAP[folderStatus.status]}
                                />

                                <span className='connection-status-text'>{folderStatus.message}</span>
                            </div>
                        )}
                    </div>
                </FormGroup>

                <FormGroup
                    label={<h3>Select performance data</h3>}
                    subLabel='Select a local directory containing performance data (optional)'
                >
                    <label
                        className='bp5-file-input'
                        htmlFor='local-performance-upload'
                    >
                        <input
                            id='local-performance-upload'
                            type='file'
                            multiple
                            /* @ts-expect-error 'directory' does not exist on native HTMLInputElement */
                            // eslint-disable-next-line react/no-unknown-property
                            directory=''
                            webkitdirectory=''
                            disabled={isSafari}
                            onChange={handlePerformanceDirectoryOpen}
                        />
                        <span className='bp5-file-upload-input'>{performanceDataUploadLabel}</span>
                    </label>

                    {performanceFolderStatus && !isUploadingPerformance && (
                        <div
                            className={`verify-connection-item status-${ConnectionTestStates[performanceFolderStatus.status]}`}
                        >
                            <Icon
                                className='connection-status-icon'
                                icon={ICON_MAP[performanceFolderStatus.status]}
                                size={20}
                                intent={INTENT_MAP[performanceFolderStatus.status]}
                            />

                            <span className='connection-status-text'>{performanceFolderStatus.message}</span>
                        </div>
                    )}
                </FormGroup>

                <Button
                    disabled={!isLocalReportMounted}
                    onClick={viewOperation}
                    icon={IconNames.EYE_OPEN}
                >
                    View report
                </Button>
            </div>
        </>
    );
};

export default LocalFolderOptions;
