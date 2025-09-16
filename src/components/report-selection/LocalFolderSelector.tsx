// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FileInput, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, type FC, useEffect, useState } from 'react';

import { useQueryClient } from 'react-query';
import { useAtom, useSetAtom } from 'jotai';
import useLocalConnection from '../../hooks/useLocal';
import {
    ReportLocation,
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
    selectedDeviceAtom,
} from '../../store/app';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import FileStatusOverlay from '../FileStatusOverlay';
import createToastNotification from '../../functions/createToastNotification';
import getServerConfig from '../../functions/getServerConfig';
import { DEFAULT_DEVICE_ID } from '../../definitions/Devices';
import {
    PERFORMANCE_FOLDER_QUERY_KEY,
    PROFILER_FOLDER_QUERY_KEY,
    deletePerformance,
    deleteProfiler,
    updateInstance,
    useInstance,
    usePerfFolderList,
    useReportFolderList,
} from '../../hooks/useAPI';
import LocalFolderPicker from './LocalFolderPicker';
import { ReportFolder } from '../../definitions/Reports';
import {
    createDataIntegrityWarning,
    hasBeenNormalised,
    normaliseReportFolder,
} from '../../functions/validateReportFolder';

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
    const [profilerReportLocation, setProfilerReportLocation] = useAtom(profilerReportLocationAtom);
    const [performanceReportLocation, setPerformanceReportLocation] = useAtom(performanceReportLocationAtom);
    const setSelectedDevice = useSetAtom(selectedDeviceAtom);
    const [activeProfilerReport, setActiveProfilerReport] = useAtom(activeProfilerReportAtom);
    const [activePerformanceReport, setActivePerformanceReport] = useAtom(activePerformanceReportAtom);

    const {
        uploadLocalFolder,
        uploadLocalPerformanceFolder,
        checkRequiredReportFiles,
        checkRequiredProfilerFiles,
        filterReportFiles,
    } = useLocalConnection();
    const { data: perfFolderList } = usePerfFolderList();
    const { data: reportFolderList } = useReportFolderList();
    const { data: instance } = useInstance();

    const [profilerFolder, setProfilerFolder] = useState<ConnectionStatus | undefined>();
    const [isUploadingReport, setIsUploadingReport] = useState(false);
    const [isUploadingPerformance, setIsPerformanceUploading] = useState(false);
    const [profilerUploadLabel, setProfilerUploadLabel] = useState('Choose directory...');
    const [performanceFolder, setPerformanceFolder] = useState<ConnectionStatus | undefined>();
    const [performanceDataUploadLabel, setPerformanceDataUploadLabel] = useState('Choose directory...');

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
        } else {
            setProfilerUploadLabel(`${files.length} files uploaded`);
            response.data = normaliseReportFolder(response.data);

            if (hasBeenNormalised(response?.data)) {
                createDataIntegrityWarning(response.data);
            }

            setSelectedDevice(DEFAULT_DEVICE_ID);
            setActiveProfilerReport(response.data.path);
            createToastNotification('Active memory report', response.data.reportName);
            setProfilerReportLocation(ReportLocation.LOCAL);
            setProfilerFolder(connectionStatus);
        }

        queryClient.clear();
        setIsUploadingReport(false);
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
            const fileName = getFolderName(files);
            setPerformanceDataUploadLabel(`${files.length} files uploaded`);
            setPerformanceReportLocation(ReportLocation.LOCAL);
            setActivePerformanceReport(fileName);
            createToastNotification('Active performance report', fileName);
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

    const handleSelectProfiler = async (item: ReportFolder) => {
        await updateInstance({ ...instance, active_report: { profiler_name: item.path } });

        if (hasBeenNormalised(item)) {
            createDataIntegrityWarning(item);
        }

        createToastNotification('Active memory report', getReportName(reportFolderList, item.path) ?? '');
        setActiveProfilerReport(item.path);
        setProfilerReportLocation(ReportLocation.LOCAL);
    };

    const handleDeleteProfiler = async (folder: ReportFolder) => {
        await deleteProfiler(folder.path);
        await queryClient.invalidateQueries([PROFILER_FOLDER_QUERY_KEY]);

        createToastNotification('Memory report deleted', folder.reportName);

        if (activeProfilerReport === folder.path) {
            setActiveProfilerReport(null);
            setProfilerUploadLabel('Choose directory...');
            setProfilerFolder(undefined);
        }
    };

    const handleSelectPerformance = async (item: ReportFolder) => {
        await updateInstance({ ...instance, active_report: { performance_name: item.path } });

        createToastNotification('Active performance report', item.reportName);
        setActivePerformanceReport(item.path);
        setPerformanceReportLocation(ReportLocation.LOCAL);
    };

    const handleDeletePerformance = async (folder: ReportFolder) => {
        await deletePerformance(folder.path);
        await queryClient.invalidateQueries([PERFORMANCE_FOLDER_QUERY_KEY]);

        createToastNotification(`Performance report deleted`, folder.reportName);

        if (activePerformanceReport === folder.reportName) {
            setActivePerformanceReport(null);
            setPerformanceDataUploadLabel('Choose directory...');
            setPerformanceFolder(undefined);
        }
    };

    const isDirectReportMode = !!getServerConfig()?.TT_METAL_HOME;

    return (
        <>
            <FormGroup
                className='form-group'
                label={<h3 className='label'>Memory report</h3>}
                subLabel='Select a memory report'
            >
                <LocalFolderPicker
                    items={reportFolderList}
                    value={
                        reportFolderList?.map((folder: ReportFolder) => folder.path).includes(activeProfilerReport) &&
                        profilerReportLocation === ReportLocation.LOCAL
                            ? activeProfilerReport
                            : null
                    }
                    handleSelect={handleSelectProfiler}
                    handleDelete={handleDeleteProfiler}
                />
            </FormGroup>

            {!isDirectReportMode && (
                <FormGroup subLabel='Upload a local memory report'>
                    <div className='form-container'>
                        <FileInput
                            id='local-upload'
                            onInputChange={handleReportDirectoryOpen}
                            text={profilerUploadLabel}
                            inputProps={{
                                // @ts-expect-error 'directory' (needed for Safari) and 'webkitdirectory' - TypeScript’s DOM types do not include non-standard attributes
                                directory: '',
                                webkitdirectory: '',
                                multiple: true,
                                'data-testid': 'local-profiler-upload',
                            }}
                        />

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
            )}
            <FormGroup
                className='form-group'
                label={<h3 className='label'>Performance report</h3>}
                subLabel='Select a performance report'
            >
                <LocalFolderPicker
                    items={perfFolderList}
                    value={
                        perfFolderList
                            ?.map((folder: ReportFolder) => folder.reportName)
                            .includes(activePerformanceReport) && performanceReportLocation === ReportLocation.LOCAL
                            ? activePerformanceReport
                            : null
                    }
                    handleSelect={handleSelectPerformance}
                    handleDelete={handleDeletePerformance}
                />
            </FormGroup>

            {!isDirectReportMode && (
                <FormGroup subLabel='Upload a local performance report'>
                    <div className='form-container'>
                        <FileInput
                            id='local-performance-upload'
                            onInputChange={handlePerformanceDirectoryOpen}
                            text={performanceDataUploadLabel}
                            inputProps={{
                                // @ts-expect-error 'directory' (needed for Safari) and 'webkitdirectory' - TypeScript’s DOM types do not include non-standard attributes
                                directory: '',
                                webkitdirectory: '',
                                multiple: true,
                                'data-testid': 'local-performance-upload',
                            }}
                        />

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
            )}
        </>
    );
};

const getFolderName = (files: FileList) => files[0].webkitRelativePath.split('/')[0];

const getReportName = (reports: ReportFolder[], path: string | null) => {
    return reports?.find((report) => report.path === path)?.reportName;
};

export default LocalFolderOptions;
