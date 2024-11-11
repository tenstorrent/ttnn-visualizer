// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, type FC, useContext, useState } from 'react';

import { useQuery, useQueryClient } from 'react-query';
import { useNavigate } from 'react-router';
import 'styles/components/FolderPicker.scss';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import ROUTES from '../../definitions/routes';
import { SocketContext } from '../../libs/SocketProvider';
import { FileStatus } from '../../model/APIData';
import FileStatusOverlay from '../FileStatusOverlay';
import useSocketUpload from '../../hooks/useSocketUpload';
import useLocal from '../../hooks/useLocal';
import { fetchTabSession } from '../../hooks/useAPI';

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
    const [folderStatus, setFolderStatus] = useState<ConnectionStatus | undefined>();
    const [localUploadLabel, setLocalUploadLabel] = useState('Choose directory...');
    const { mountLocalFolder } = useLocal();
    const { socket } = useContext(SocketContext);

    const { data: tabSession, refetch: refetchSession } = useQuery('tabSession', {
        queryFn: fetchTabSession,
        initialData: null,
        onSuccess: (data) => {
            if (data?.active_report && !data.remote_connection && !data.remote_folder) {
                setFolderStatus({
                    status: ConnectionTestStates.OK,
                    message: `Report ${data.active_report.name} Uploaded`,
                });
            }
        },
    });

    const onUploadComplete = async ({ directoryName }: { directoryName: string }) => {
        await mountLocalFolder({ reportFolder: directoryName });
        await refetchSession();
    };

    const { uploadDirectory, progress, isUploading } = useSocketUpload({ socket, onUploadFinished: onUploadComplete });

    const isLocalReportMounted =
        tabSession?.active_report && !tabSession.remote_connection && !tabSession.remote_folder;

    const checkRequiredFiles = (files: FileList): boolean => {
        const requiredFiles = ['db.sqlite', 'config.json'];
        const fileSet = new Set<string>();

        Array.from(files).forEach((file) => {
            const pathParts = file.webkitRelativePath.split('/');
            if (pathParts.length === 2) {
                // Top-level files should have exactly 2 parts in their path
                fileSet.add(pathParts[1]); // Add the file name to the set
            }
        });

        return requiredFiles.every((file) => fileSet.has(file));
    };

    /**
     * This is a temporrary solution until we support Safari
     */
    const ua = navigator.userAgent.toLowerCase();
    const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android');

    const handleDirectoryOpen = (e: ChangeEvent<HTMLInputElement>) => {
        // TODO Validate files before sending
        if (!e.target.files) {
            return;
        }
        const { files } = e.target;

        if (!checkRequiredFiles(files)) {
            setFolderStatus({ status: ConnectionTestStates.FAILED, message: 'Invalid report directory' });
        } else {
            setLocalUploadLabel(`${files.length} files selected.`);
            uploadDirectory(files);
        }
    };

    const viewOperation = () => {
        // keeping this here temporarily until proven otherwise
        queryClient.clear();
        navigate(ROUTES.OPERATIONS);
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
            <FormGroup
                label={<h3>Select local report</h3>}
                labelFor='text-input'
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
                            onChange={handleDirectoryOpen}
                        />
                        <span className='bp5-file-upload-input'>{localUploadLabel}</span>
                    </label>
                    <Button
                        disabled={!isLocalReportMounted}
                        onClick={viewOperation}
                        icon={IconNames.EYE_OPEN}
                    >
                        View report
                    </Button>
                    <FileStatusOverlay
                        open={
                            isUploading ||
                            [
                                FileStatus.DOWNLOADING,
                                FileStatus.COMPRESSING,
                                FileStatus.STARTED,
                                FileStatus.UPLOADING,
                            ].includes(progress?.status)
                        }
                        progress={progress}
                    />

                    {folderStatus && !isUploading && (
                        <div className={`verify-connection-item status-${ConnectionTestStates[folderStatus.status]}`}>
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
        </>
    );
};

export default LocalFolderOptions;
