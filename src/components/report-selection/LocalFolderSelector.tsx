// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, FormGroup, Icon, IconName, Intent, MenuItem } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, type FC, useEffect, useState } from 'react';

import 'styles/components/FolderPicker.scss';
import { useQueryClient } from 'react-query';
import { useAtom, useSetAtom } from 'jotai';
import { ItemRenderer, Select } from '@blueprintjs/select';
import useLocalConnection from '../../hooks/useLocal';
import { activePerformanceTraceAtom, activeReportAtom, reportLocationAtom, selectedDeviceAtom } from '../../store/app';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import FileStatusOverlay from '../FileStatusOverlay';
import createToastNotification from '../../functions/createToastNotification';
import { DEFAULT_DEVICE_ID } from '../../definitions/Devices';
import { deleteReport, updateTabSession, usePerfFolderList, useSession } from '../../hooks/useAPI';
import { isEqual } from '../../functions/math';

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
    const setActiveReport = useSetAtom(activeReportAtom);
    const [activePerformanceTrace, setActivePerformanceTrace] = useAtom(activePerformanceTraceAtom);

    const {
        uploadLocalFolder,
        uploadLocalPerformanceFolder,
        checkRequiredReportFiles,
        checkRequiredProfilerFiles,
        filterReportFiles,
    } = useLocalConnection();
    const { data: perfFolderList } = usePerfFolderList();
    const { data: session } = useSession(null, null, null);

    const [folderStatus, setFolderStatus] = useState<ConnectionStatus | undefined>();
    const [isUploadingReport, setIsUploadingReport] = useState(false);
    const [isUploadingPerformance, setIsPerformanceUploading] = useState(false);
    const [localUploadLabel, setLocalUploadLabel] = useState('Choose directory...');
    const [performanceFolderStatus, setPerformanceFolderStatus] = useState<ConnectionStatus | undefined>();
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
            setFolderStatus(invalidReportStatus);
            return;
        }

        let connectionStatus = connectionOkStatus;

        setIsUploadingReport(true);
        setLocalUploadLabel(`${files.length} files selected.`);

        const response = await uploadLocalFolder(files);

        if (response.status !== 200) {
            connectionStatus = connectionFailedStatus;
        } else if (response?.data?.status !== ConnectionTestStates.OK) {
            connectionStatus = directoryErrorStatus;
        } else {
            const fileName = getReportName(files);

            setLocalUploadLabel(`${files.length} files uploaded`);
            setReportLocation('local');
            setSelectedDevice(DEFAULT_DEVICE_ID);
            setActiveReport(fileName);
            createToastNotification('Active report', fileName);
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
        setPerformanceFolderStatus(connectionStatus);
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

    const renderFilm: ItemRenderer<string> = (folder, { handleClick, handleFocus, modifiers }) => {
        if (!modifiers.matchesPredicate) {
            return null;
        }
        return (
            <>
                <MenuItem
                    text={folder}
                    label={folder}
                    roleStructure='listoption'
                    active={isEqual(activePerformanceTrace, folder)}
                    disabled={modifiers.disabled}
                    key={folder}
                    onClick={handleClick}
                    onFocus={handleFocus}
                />
                <Button
                    icon={IconNames.Delete}
                    onClick={() => handleDeletePerformanceTrace(folder)}
                />
            </>
        );
    };

    const handleDeletePerformanceTrace = async (folder: string) => {
        await deleteReport(folder);
        await queryClient.invalidateQueries(['fetch-perf-folder-list']);

        if (activePerformanceTrace === folder) {
            setActivePerformanceTrace(null);
            setPerformanceDataUploadLabel('Choose directory...');
            setPerformanceFolderStatus(undefined);
        }
    };

    const handleItemSelect = async (item: string) => {
        await updateTabSession({ active_report: { ...session, profile_name: item } });
        setActivePerformanceTrace(item);
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
                    subLabel='Select a local directory containing performance data'
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
                    </div>
                </FormGroup>

                {activePerformanceTrace}

                <div className='bp5-form-group'>
                    <div className='bp5-form-group-sub-label'>Select a performance trace from the list below</div>

                    <Select
                        items={perfFolderList ?? []}
                        // itemPredicate={filterFilm}
                        itemRenderer={renderFilm}
                        noResults={
                            <MenuItem
                                disabled
                                text='No results.'
                                roleStructure='listoption'
                            />
                        }
                        onItemSelect={handleItemSelect}
                        disabled={!perfFolderList}
                    >
                        <Button text={activePerformanceTrace ?? 'Select a film'} />
                    </Select>
                </div>
            </div>
        </>
    );
};

const getReportName = (files: FileList) => files[0].webkitRelativePath.split('/')[0];

export default LocalFolderOptions;
