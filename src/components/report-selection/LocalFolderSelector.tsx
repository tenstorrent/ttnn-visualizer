// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FileInput, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, useEffect, useMemo, useState } from 'react';

import { useQueryClient } from '@tanstack/react-query';
import { useAtom } from 'jotai';
import useLocalConnection from '../../hooks/useLocal';
import {
    activePerformanceReportAtom,
    activeProfilerReportAtom,
    performanceReportLocationAtom,
    profilerReportLocationAtom,
} from '../../store/app';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import {
    ACTIVE_MEMORY_REPORT_TOAST_TITLE,
    ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE,
    MEMORY_REPORT_DELETED_TOAST_TITLE,
    MEMORY_REPORT_DELETE_FAILED_TOAST_TITLE,
    PERFORMANCE_REPORT_DELETED_TOAST_TITLE,
    PERFORMANCE_REPORT_DELETE_FAILED_TOAST_TITLE,
} from '../../definitions/notifyActiveReport';
import createToastNotification from '../../functions/createToastNotification';
import { ToastType } from '../../definitions/ToastType';
import getResponseError from '../../functions/getResponseError';
import isDirectReportMode from '../../functions/isDirectReportMode';
import {
    PERFORMANCE_FOLDER_QUERY_KEY,
    PROFILER_FOLDER_QUERY_KEY,
    clearReportCaches,
    deletePerformance,
    deleteProfiler,
    updateInstance,
    usePerfFolderList,
    useReportFolderList,
    useReportMetadata,
} from '../../hooks/useAPI';
import { useActivatingReport } from '../../hooks/useActivatingReport';
import { useReportLinkBadgeIds } from '../../hooks/useReportLinkBadgeIds';
import LocalFolderPicker from './LocalFolderPicker';
import { ReportFolder, ReportLocation } from '../../definitions/Reports';
import {
    createDataIntegrityWarning,
    hasBeenNormalised,
    normaliseReportFolder,
} from '../../functions/validateReportFolder';
import { TEST_IDS } from '../../definitions/TestIds';
import { DBVersionValidation } from '../../definitions/Versions';
import { evaluateDbVersion } from '../../functions/compareDbVersion';
import { ReportKind, ReportLoadFailureReason, ReportSource } from '../../definitions/UsageEvent';
import {
    getReportLoadFailureReason,
    recordReportLoadFailed,
    recordReportLoaded,
} from '../../functions/reportLoadUsage';

const ICON_MAP: Record<ConnectionTestStates, IconName> = {
    [ConnectionTestStates.IDLE]: IconNames.DOT,
    [ConnectionTestStates.PROGRESS]: IconNames.DOT,
    [ConnectionTestStates.FAILED]: IconNames.CROSS,
    [ConnectionTestStates.OK]: IconNames.TICK,
    [ConnectionTestStates.WARNING]: IconNames.WARNING_SIGN,
};

const INTENT_MAP: Record<ConnectionTestStates, Intent> = {
    [ConnectionTestStates.IDLE]: Intent.NONE,
    [ConnectionTestStates.PROGRESS]: Intent.WARNING,
    [ConnectionTestStates.FAILED]: Intent.DANGER,
    [ConnectionTestStates.OK]: Intent.SUCCESS,
    [ConnectionTestStates.WARNING]: Intent.WARNING,
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
    message: 'Selected directory does not contain a valid report',
};

const directoryErrorStatus: ConnectionStatus = {
    status: ConnectionTestStates.FAILED,
    message: 'Selected directory does not contain a valid report',
};

const CHOOSE_DIRECTORY_LABEL = 'Choose directory...';

/** The parts a report delete differs by; the sequence around them is identical for both kinds. */
interface DeleteReportOptions {
    sendDelete: (reportPath: string) => Promise<unknown>;
    folderQueryKey: string;
    failedTitle: string;
    deletedTitle: string;
    isActive: boolean;
    clearActive: () => void;
}

const LocalFolderOptions = () => {
    const queryClient = useQueryClient();
    const [profilerReportLocation, setProfilerReportLocation] = useAtom(profilerReportLocationAtom);
    const [performanceReportLocation, setPerformanceReportLocation] = useAtom(performanceReportLocationAtom);
    const [activeProfilerReport, setActiveProfilerReport] = useAtom(activeProfilerReportAtom);
    const [activePerformanceReport, setActivePerformanceReport] = useAtom(activePerformanceReportAtom);
    const { isActivatingReport, withActivatingReport } = useActivatingReport();

    const {
        uploadLocalFolder,
        uploadLocalPerformanceFolder,
        checkRequiredReportFiles,
        checkRequiredPerformanceFiles,
        filterReportFiles,
    } = useLocalConnection();
    const { data: perfFolderList } = usePerfFolderList();
    const { data: reportFolderList } = useReportFolderList();

    const { data: reportMetadata, error: reportMetadataError } = useReportMetadata();
    useEffect(() => {
        if (reportMetadataError) {
            return;
        }
        if (reportMetadata) {
            const dbValidationResult = evaluateDbVersion(reportMetadata.version);
            if (dbValidationResult.statusCode !== DBVersionValidation.OK) {
                // @ts-expect-error this is good
                createToastNotification('Incompatible report version', dbValidationResult.message, ToastType.WARNING);
            }
        }
    }, [reportMetadata, reportMetadataError]);

    const [profilerFolder, setProfilerFolder] = useState<ConnectionStatus | undefined>();
    const [isUploadingReport, setIsUploadingReport] = useState(false);
    const [isUploadingPerformance, setIsPerformanceUploading] = useState(false);
    const [profilerUploadLabel, setProfilerUploadLabel] = useState(CHOOSE_DIRECTORY_LABEL);
    const [performanceFolder, setPerformanceFolder] = useState<ConnectionStatus | undefined>();
    const [performanceDataUploadLabel, setPerformanceDataUploadLabel] = useState(CHOOSE_DIRECTORY_LABEL);

    const isProfilerLocal = profilerReportLocation === ReportLocation.LOCAL;
    const isPerformanceLocal = performanceReportLocation === ReportLocation.LOCAL;

    const folderPickerValue = useMemo(
        () =>
            activeProfilerReport &&
            reportFolderList?.some((folder: ReportFolder) => folder.path.includes(activeProfilerReport.path)) &&
            isProfilerLocal
                ? activeProfilerReport.path
                : null,
        [activeProfilerReport, reportFolderList, isProfilerLocal],
    );

    const perfFolderPickerValue = useMemo(
        () =>
            activePerformanceReport &&
            perfFolderList?.some((folder: ReportFolder) => folder.path.includes(activePerformanceReport.path)) &&
            isPerformanceLocal
                ? activePerformanceReport.path
                : null,
        [activePerformanceReport, perfFolderList, isPerformanceLocal],
    );

    const { linkedPerfIds, unlinkedPerfIds, linkedProfilerReportIds, unlinkedProfilerReportIds } =
        useReportLinkBadgeIds();

    const handleReportDirectoryOpen = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) {
            return;
        }

        const { files: unfilteredFiles } = e.target;
        const files = filterReportFiles(unfilteredFiles);

        if (!checkRequiredReportFiles(files)) {
            setProfilerFolder(invalidReportStatus);
            recordReportLoadFailed(ReportKind.PROFILER, ReportLoadFailureReason.MISSING_FILE);
            return;
        }

        setIsUploadingReport(true);
        setProfilerUploadLabel(`${files.length} files selected.`);

        try {
            const response = await uploadLocalFolder(files);

            setProfilerUploadLabel(`${files.length} files uploaded`);
            response.data = normaliseReportFolder(response.data);

            if (hasBeenNormalised(response?.data)) {
                createDataIntegrityWarning(response.data);
            }

            const updatedReport = {
                path: response.data.path,
                reportName: response.data.reportName,
            };

            setActiveProfilerReport(updatedReport);
            createToastNotification(ACTIVE_MEMORY_REPORT_TOAST_TITLE, updatedReport.reportName, ToastType.SUCCESS);
            setProfilerReportLocation(ReportLocation.LOCAL);
            setProfilerFolder(connectionOkStatus);
            recordReportLoaded(ReportKind.PROFILER, ReportSource.UPLOAD);
        } catch (err: unknown) {
            const message = getResponseError(err, 'Unable to upload selected directory');
            setProfilerFolder({ status: ConnectionTestStates.FAILED, message });
            recordReportLoadFailed(ReportKind.PROFILER, getReportLoadFailureReason(err));
        } finally {
            clearReportCaches(queryClient);
            setIsUploadingReport(false);
        }
    };

    const handlePerformanceDirectoryOpen = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files?.length) {
            return;
        }

        const { files: unfilteredFiles } = e.target;
        const files = filterReportFiles(unfilteredFiles);

        if (!checkRequiredPerformanceFiles(files)) {
            setPerformanceFolder(invalidProfilerStatus);
            recordReportLoadFailed(ReportKind.PERFORMANCE, ReportLoadFailureReason.MISSING_FILE);
            return;
        }

        setIsPerformanceUploading(true);
        setPerformanceDataUploadLabel(`${files.length} files selected`);

        try {
            const response = await uploadLocalPerformanceFolder(files);

            if (response?.data?.status !== ConnectionTestStates.OK) {
                setPerformanceFolder(directoryErrorStatus);
                recordReportLoadFailed(ReportKind.PERFORMANCE, ReportLoadFailureReason.MISSING_FILE);
            } else {
                const fileName = getFolderName(files);
                setPerformanceDataUploadLabel(`${files.length} files uploaded`);
                setPerformanceReportLocation(ReportLocation.LOCAL);
                setActivePerformanceReport({ path: fileName, reportName: fileName });
                createToastNotification(ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE, fileName, ToastType.SUCCESS);
                setPerformanceFolder(connectionOkStatus);
                recordReportLoaded(ReportKind.PERFORMANCE, ReportSource.UPLOAD);
            }
        } catch (err: unknown) {
            const message = getResponseError(err, 'Unable to upload selected directory');
            setPerformanceFolder({ status: ConnectionTestStates.FAILED, message });
            recordReportLoadFailed(ReportKind.PERFORMANCE, getReportLoadFailureReason(err));
        } finally {
            clearReportCaches(queryClient);
            setIsPerformanceUploading(false);
        }
    };

    const handleSelectProfiler = async (folder: ReportFolder) => {
        try {
            await withActivatingReport(async () => {
                // Backend handles updating only the specific parts of active_report
                await updateInstance({
                    active_report: { profiler_name: folder.path, profiler_location: ReportLocation.LOCAL },
                });

                if (hasBeenNormalised(folder)) {
                    createDataIntegrityWarning(folder);
                }

                createToastNotification(ACTIVE_MEMORY_REPORT_TOAST_TITLE, folder.reportName ?? '', ToastType.SUCCESS);
                setActiveProfilerReport(folder);
                setProfilerReportLocation(ReportLocation.LOCAL);
                recordReportLoaded(ReportKind.PROFILER, ReportSource.LOCAL_TT_METAL);
            });
        } catch (err: unknown) {
            recordReportLoadFailed(ReportKind.PROFILER, getReportLoadFailureReason(err));
            throw err;
        }
    };

    const deleteReport = async (folder: ReportFolder, options: DeleteReportOptions) => {
        try {
            await options.sendDelete(folder.path);
        } catch (err: unknown) {
            createToastNotification(options.failedTitle, getResponseError(err), ToastType.ERROR);
            return;
        }

        await queryClient.invalidateQueries({ queryKey: [options.folderQueryKey] });

        createToastNotification(options.deletedTitle, folder.reportName, ToastType.INFO);

        if (options.isActive) {
            options.clearActive();
        }
    };

    const handleDeleteProfiler = (folder: ReportFolder) =>
        deleteReport(folder, {
            sendDelete: deleteProfiler,
            folderQueryKey: PROFILER_FOLDER_QUERY_KEY,
            failedTitle: MEMORY_REPORT_DELETE_FAILED_TOAST_TITLE,
            deletedTitle: MEMORY_REPORT_DELETED_TOAST_TITLE,
            isActive: activeProfilerReport?.path === folder.path,
            clearActive: () => {
                setActiveProfilerReport(null);
                setProfilerUploadLabel(CHOOSE_DIRECTORY_LABEL);
                setProfilerFolder(undefined);
            },
        });

    const handleSelectPerformance = async (folder: ReportFolder) => {
        try {
            await withActivatingReport(async () => {
                // Backend handles updating only the specific parts of active_report
                await updateInstance({
                    active_report: { performance_name: folder.path, performance_location: ReportLocation.LOCAL },
                });

                createToastNotification(ACTIVE_PERFORMANCE_REPORT_TOAST_TITLE, folder.reportName, ToastType.SUCCESS);
                setActivePerformanceReport(folder);
                setPerformanceReportLocation(ReportLocation.LOCAL);
                recordReportLoaded(ReportKind.PERFORMANCE, ReportSource.LOCAL_TT_METAL);
            });
        } catch (err: unknown) {
            recordReportLoadFailed(ReportKind.PERFORMANCE, getReportLoadFailureReason(err));
            throw err;
        }
    };

    const handleDeletePerformance = (folder: ReportFolder) =>
        deleteReport(folder, {
            sendDelete: deletePerformance,
            folderQueryKey: PERFORMANCE_FOLDER_QUERY_KEY,
            failedTitle: PERFORMANCE_REPORT_DELETE_FAILED_TOAST_TITLE,
            deletedTitle: PERFORMANCE_REPORT_DELETED_TOAST_TITLE,
            isActive: activePerformanceReport?.path === folder.path,
            clearActive: () => {
                setActivePerformanceReport(null);
                setPerformanceDataUploadLabel(CHOOSE_DIRECTORY_LABEL);
                setPerformanceFolder(undefined);
            },
        });

    return (
        <>
            <FormGroup
                className='form-group'
                label={<h3 className='label'>Memory report</h3>}
                subLabel='Select a memory report'
            >
                <LocalFolderPicker
                    items={reportFolderList}
                    value={isProfilerLocal ? folderPickerValue : null}
                    valueLabel={activeProfilerReport?.reportName ?? null}
                    handleSelect={handleSelectProfiler}
                    handleDelete={handleDeleteProfiler}
                    loading={isActivatingReport}
                    linkedIds={linkedProfilerReportIds}
                    unlinkedIds={unlinkedProfilerReportIds}
                    showReportName
                />
            </FormGroup>

            {!isDirectReportMode() && (
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
                                'data-testid': TEST_IDS.LOCAL_PROFILER_UPLOAD,
                            }}
                        />

                        {profilerFolder && !isUploadingReport && (
                            <div
                                className='folder-upload-status'
                                data-testid={TEST_IDS.LOCAL_PROFILER_STATUS}
                            >
                                <Icon
                                    icon={ICON_MAP[profilerFolder.status]}
                                    size={20}
                                    intent={INTENT_MAP[profilerFolder.status]}
                                />

                                <span className='message'>{profilerFolder.message}</span>
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
                    value={isPerformanceLocal ? perfFolderPickerValue : null}
                    valueLabel={activePerformanceReport?.reportName ?? null}
                    handleSelect={handleSelectPerformance}
                    handleDelete={handleDeletePerformance}
                    loading={isActivatingReport}
                    linkedIds={linkedPerfIds}
                    unlinkedIds={unlinkedPerfIds}
                />
            </FormGroup>

            {!isDirectReportMode() && (
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
                                'data-testid': TEST_IDS.LOCAL_PERFORMANCE_UPLOAD,
                            }}
                        />

                        {performanceFolder && !isUploadingPerformance && (
                            <div
                                className='folder-upload-status'
                                data-testid={TEST_IDS.LOCAL_PERFORMANCE_STATUS}
                            >
                                <Icon
                                    icon={ICON_MAP[performanceFolder.status]}
                                    size={20}
                                    intent={INTENT_MAP[performanceFolder.status]}
                                />

                                <span className='message'>{performanceFolder.message}</span>
                            </div>
                        )}
                    </div>
                </FormGroup>
            )}
        </>
    );
};

const getFolderName = (files: FileList) => files[0].webkitRelativePath.split('/')[0];

export default LocalFolderOptions;
