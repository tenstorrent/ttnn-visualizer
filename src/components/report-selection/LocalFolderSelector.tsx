// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, type FC, useEffect, useState } from 'react';

import 'styles/components/FolderPicker.scss';
import { useNavigate } from 'react-router';
import { useQueryClient } from 'react-query';
import { useAtom } from 'jotai';
import ROUTES from '../../definitions/routes';
import useLocalConnection from '../../hooks/useLocal';
import { reportLocationAtom } from '../../store/app';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import FileStatusOverlay from '../FileStatusOverlay';
import { useSession } from '../../hooks/useAPI';

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

const connectionOkStatus: ConnectionStatus = {
    status: ConnectionTestStates.OK,
    message: 'Files uploaded successfully',
};

const invalidReportStatus: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Selected directory does not contain a valid report',
};

const invalidProfilerStatus: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Selected directory is not a valid profiler run',
};

const directoryErrorStatus: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Selected directory does not contain a valid report.',
};

const connectionFailedStatus: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Unable to upload selected directory.',
};

const LocalFolderOptions: FC = () => {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [reportLocation, setReportLocation] = useAtom(reportLocationAtom);
    const { data: tabSession } = useSession();

    const {
        uploadLocalFolder,
        uploadLocalPerformanceFolder,
        checkRequiredReportFiles,
        checkRequiredProfilerFiles,
        filterReportFiles,
        getUploadedFolderName,
    } = useLocalConnection();

    const [folderStatus, setFolderStatus] = useState<ConnectionStatus | undefined>();
    const [isUploadingReport, setIsUploadingReport] = useState(false);
    const [isUploadingPerformance, setIsPerformanceUploading] = useState(false);
    const [localUploadLabel, setLocalUploadLabel] = useState('Choose directory...');
    const [uploadedReportName, setUploadedReportName] = useState<string | null>(
        tabSession?.active_report?.report_name ?? null,
    );
    const [performanceFolderStatus, setPerformanceFolderStatus] = useState<ConnectionStatus | undefined>();
    const [performanceDataUploadLabel, setPerformanceDataUploadLabel] = useState('Choose directory...');

    const isLocalReportMounted =
        !isUploadingReport &&
        !isUploadingPerformance &&
        reportLocation === 'local' &&
        tabSession?.active_report?.report_name;

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

        if (!checkRequiredReportFiles(files)) {
            setFolderStatus(invalidReportStatus);
            return;
        }

        let connectionStatus = connectionOkStatus;

        setIsUploadingReport(true);
        setLocalUploadLabel(`${files.length} files selected.`);

        // TODO Get the report name from the successfully uploaded files
        const response = await uploadLocalFolder(files);

        if (response.status !== 200) {
            connectionStatus = connectionFailedStatus;
        } else if (response?.data?.status !== ConnectionTestStates.OK) {
            connectionStatus = directoryErrorStatus;
        } else {
            setUploadedReportName(getUploadedFolderName(files));
            setLocalUploadLabel(`${files.length} files uploaded`);
            setReportLocation('local');
        }

        queryClient.clear();
        setIsUploadingReport(false);
        setFolderStatus(connectionStatus);
    };

    const handlePerformanceDirectoryOpen = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) {
            return;
        }

        const { files: unfilteredFiles } = e.target;
        const files = filterReportFiles(unfilteredFiles);

        if (!checkRequiredProfilerFiles(files)) {
            setPerformanceFolderStatus(invalidProfilerStatus);
            return;
        }

        let connectionStatus = connectionOkStatus;

        setIsPerformanceUploading(true);
        setPerformanceDataUploadLabel(`${files.length} files selected`);

        const response = await uploadLocalPerformanceFolder(files, uploadedReportName);

        if (response.status !== 200) {
            connectionStatus = connectionFailedStatus;
        } else if (response?.data?.status !== ConnectionTestStates.OK) {
            connectionStatus = directoryErrorStatus;
        } else {
            setPerformanceDataUploadLabel(`${files.length} files uploaded`);
            setReportLocation('local');
        }

        queryClient.clear();
        setIsPerformanceUploading(false);
        setPerformanceFolderStatus(connectionStatus);
    };

    const viewOperation = () => {
        // keeping this here temporarily until proven otherwise
        queryClient.clear();

        navigate(ROUTES.OPERATIONS);
    };

    useEffect(() => {
        if (isUploadingReport) {
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
    }, [isUploadingReport, isUploadingPerformance]);

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
                    label={<h3>Report folder</h3>}
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

                        <FileStatusOverlay />

                        {folderStatus && !isUploadingReport && (
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
                    label={<h3>Performance data folder</h3>}
                    subLabel='Select a local directory containing performance data (optional)'
                >
                    <div className='buttons-container'>
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
                                disabled={
                                    isSafari || (!tabSession?.active_report?.profile_name && !isLocalReportMounted)
                                }
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
                    </div>
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
