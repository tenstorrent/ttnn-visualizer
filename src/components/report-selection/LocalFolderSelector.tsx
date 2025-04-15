// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, type FC, useEffect, useState } from 'react';

import 'styles/components/OldFolderPicker.scss';
import { useQueryClient } from 'react-query';
import { useAtom, useSetAtom } from 'jotai';
import useLocalConnection from '../../hooks/useLocal';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    reportLocationAtom,
    selectedDeviceAtom,
} from '../../store/app';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import FileStatusOverlay from '../FileStatusOverlay';
import createToastNotification from '../../functions/createToastNotification';
import { DEFAULT_DEVICE_ID } from '../../definitions/Devices';
import {
    PERFORMANCE_FOLDER_QUERY_KEY,
    PROFILER_FOLDER_QUERY_KEY,
    deletePerformance,
    deleteProfiler,
    updateTabSession,
    usePerfFolderList,
    useReportFolderList,
    useSession,
} from '../../hooks/useAPI';
import LocalFolderPicker from './LocalFolderPicker';

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
    const queryClient = useQueryClient();
    const setReportLocation = useSetAtom(reportLocationAtom);
    const setSelectedDevice = useSetAtom(selectedDeviceAtom);
    const [activeProfilerReport, setActiveProfilerReport] = useAtom(activeProfilerReportAtom);
    const [activePerformanceTrace, setActivePerformanceTrace] = useAtom(activePerformanceReportAtom);

    const {
        uploadLocalFolder,
        uploadLocalPerformanceFolder,
        checkRequiredReportFiles,
        checkRequiredProfilerFiles,
        filterReportFiles,
    } = useLocalConnection();
    const { data: perfFolderList } = usePerfFolderList();
    const { data: reportFolderList } = useReportFolderList();
    const { data: session } = useSession();

    const [profilerFolder, setProfilerFolder] = useState<ConnectionStatus | undefined>();
    const [isUploadingReport, setIsUploadingReport] = useState(false);
    const [isUploadingPerformance, setIsPerformanceUploading] = useState(false);
    const [profilerUploadLabel, setProfilerUploadLabel] = useState('Choose directory...');
    const [performanceFolder, setPerformanceFolder] = useState<ConnectionStatus | undefined>();
    const [performanceDataUploadLabel, setPerformanceDataUploadLabel] = useState('Choose directory...');

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
            setProfilerFolder(invalidReportStatus);
            return;
        }

        let connectionStatus = connectionOkStatus;

        setIsUploadingReport(true);
        setProfilerUploadLabel(`${files.length} files selected.`);

        const response = await uploadLocalFolder(files);

        if (response.status !== 200) {
            connectionStatus = connectionFailedStatus;
        } else if (response?.data?.status !== ConnectionTestStates.OK) {
            connectionStatus = directoryErrorStatus;
        } else {
            const fileName = getReportName(files);

            setProfilerUploadLabel(`${files.length} files uploaded`);
            setReportLocation('local');
            setSelectedDevice(DEFAULT_DEVICE_ID);
            setActiveProfilerReport(fileName);
            createToastNotification('Active report', fileName);
        }

        queryClient.clear();
        setIsUploadingReport(false);
        setProfilerFolder(connectionStatus);
    };

    const handlePerformanceDirectoryOpen = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) {
            return;
        }

        const { files: unfilteredFiles } = e.target;
        const files = filterReportFiles(unfilteredFiles);

        if (!checkRequiredProfilerFiles(files)) {
            setPerformanceFolder(invalidProfilerStatus);
            return;
        }

        let connectionStatus = connectionOkStatus;

        setIsPerformanceUploading(true);
        setPerformanceDataUploadLabel(`${files.length} files selected`);

        const response = await uploadLocalPerformanceFolder(files);

        if (response.status !== 200) {
            connectionStatus = connectionFailedStatus;
        } else if (response?.data?.status !== ConnectionTestStates.OK) {
            connectionStatus = directoryErrorStatus;
        } else {
            const fileName = getReportName(files);
            setPerformanceDataUploadLabel(`${files.length} files uploaded`);
            setReportLocation('local');
            setActivePerformanceTrace(fileName);
            createToastNotification('Active performance trace', fileName);
        }

        queryClient.clear();
        setIsPerformanceUploading(false);
        setPerformanceFolder(connectionStatus);
    };

    useEffect(() => {
        if (isUploadingReport) {
            setProfilerFolder({
                status: ConnectionTestStates.PROGRESS,
                message: 'Files uploading...',
            });
        }

        if (isUploadingPerformance) {
            setPerformanceFolder({
                status: ConnectionTestStates.PROGRESS,
                message: 'Files uploading...',
            });
        }
    }, [isUploadingReport, isUploadingPerformance]);

    const handleSelectProfiler = async (item: string) => {
        await updateTabSession({ ...session, active_report: { profiler_name: item } });
        setActiveProfilerReport(item);
    };

    const handleDeleteProfiler = async (folder: string) => {
        await deleteProfiler(folder);
        await queryClient.invalidateQueries([PROFILER_FOLDER_QUERY_KEY]);

        if (activeProfilerReport === folder) {
            setActiveProfilerReport(null);
            setProfilerUploadLabel('Choose directory...');
            setProfilerFolder(undefined);
        }
    };

    const handleSelectPerformance = async (item: string) => {
        await updateTabSession({ ...session, active_report: { performance_name: item } });
        setActivePerformanceTrace(item);
    };

    const handleDeletePerformance = async (folder: string) => {
        await deletePerformance(folder);
        await queryClient.invalidateQueries([PERFORMANCE_FOLDER_QUERY_KEY]);

        if (activePerformanceTrace === folder) {
            setActivePerformanceTrace(null);
            setPerformanceDataUploadLabel('Choose directory...');
            setPerformanceFolder(undefined);
        }
    };

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
                    subLabel='Select a performance trace from the list below'
                >
                    <LocalFolderPicker
                        items={reportFolderList}
                        value={reportFolderList?.includes(activeProfilerReport) ? activeProfilerReport : null}
                        handleSelect={handleSelectProfiler}
                        handleDelete={handleDeleteProfiler}
                    />
                </FormGroup>

                <FormGroup subLabel='Select a local directory containing a report'>
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
                            <span className='bp5-file-upload-input'>{profilerUploadLabel}</span>
                        </label>

                        <FileStatusOverlay />

                        {profilerFolder && !isUploadingReport && (
                            <div
                                className={`verify-connection-item status-${ConnectionTestStates[profilerFolder.status]}`}
                            >
                                <Icon
                                    className='connection-status-icon'
                                    icon={ICON_MAP[profilerFolder.status]}
                                    size={20}
                                    intent={INTENT_MAP[profilerFolder.status]}
                                />

                                <span className='connection-status-text'>{profilerFolder.message}</span>
                            </div>
                        )}
                    </div>
                </FormGroup>

                <FormGroup
                    label={<h3>Performance data folder</h3>}
                    subLabel='Select a performance trace from the list below'
                >
                    <LocalFolderPicker
                        items={perfFolderList}
                        value={perfFolderList?.includes(activePerformanceTrace) ? activePerformanceTrace : null}
                        handleSelect={handleSelectPerformance}
                        handleDelete={handleDeletePerformance}
                    />
                </FormGroup>

                <FormGroup subLabel='Upload a local directory containing performance data'>
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
                                disabled={isSafari}
                                onChange={handlePerformanceDirectoryOpen}
                            />
                            <span className='bp5-file-upload-input'>{performanceDataUploadLabel}</span>
                        </label>

                        {performanceFolder && !isUploadingPerformance && (
                            <div
                                className={`verify-connection-item status-${ConnectionTestStates[performanceFolder.status]}`}
                            >
                                <Icon
                                    className='connection-status-icon'
                                    icon={ICON_MAP[performanceFolder.status]}
                                    size={20}
                                    intent={INTENT_MAP[performanceFolder.status]}
                                />

                                <span className='connection-status-text'>{performanceFolder.message}</span>
                            </div>
                        )}
                    </div>
                </FormGroup>
            </div>
        </>
    );
};

const getReportName = (files: FileList) => files[0].webkitRelativePath.split('/')[0];

export default LocalFolderOptions;
