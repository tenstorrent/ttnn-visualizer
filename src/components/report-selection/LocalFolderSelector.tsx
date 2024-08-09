// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ChangeEvent, type FC, useEffect, useState } from 'react';

import 'styles/components/FolderPicker.scss';
import { useNavigate } from 'react-router';
import { useQueryClient } from 'react-query';
import { useAtom, useAtomValue } from 'jotai';
import ROUTES from '../../definitions/routes';
import useLocalConnection from '../../hooks/useLocal';
import { localUploadProgressAtom, reportLocationAtom, reportMetaAtom } from '../../store/app';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';
import ProgressBar from '../ProgressBar';

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
    const meta = useAtomValue(reportMetaAtom);
    const [reportLocation, setReportLocation] = useAtom(reportLocationAtom);

    const { uploadLocalFolder } = useLocalConnection();
    const [folderStatus, setFolderStatus] = useState<ConnectionStatus | undefined>();
    const [isUploading, setIsUploading] = useState(false);
    const [localUploadLabel, setLocalUploadLabel] = useState('Choose directory...');
    const localUploadProgress = useAtomValue(localUploadProgressAtom);

    const isLocalReportMounted =
        (!isUploading && meta && reportLocation === 'local') || folderStatus?.status === ConnectionTestStates.OK;

    const handleDirectoryOpen = async (e: ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) {
            return;
        }
        const { files } = e.target;
        const connectionStatus: ConnectionStatus = {
            status: ConnectionTestStates.OK,
            message: 'Files uploaded successfully',
        };

        setIsUploading(true);

        setLocalUploadLabel(`${files.length} files selected.`);
        const response = await uploadLocalFolder(files);

        if (response.status !== 200) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Unable to upload selected directory.';
        }

        if (response.data.status !== 200) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Selected directory does not contain a valid report.';
        }

        setLocalUploadLabel(`${files.length} files uploaded`);
        setIsUploading(false);
        setFolderStatus(connectionStatus);
    };

    const viewOperation = () => {
        queryClient.clear();

        setReportLocation('local');

        navigate(ROUTES.OPERATIONS);
    };

    useEffect(() => {
        if (isUploading) {
            setFolderStatus({
                status: ConnectionTestStates.PROGRESS,
                message: 'Files uploading...',
            });
        }
    }, [isUploading]);

    return (
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

                {isUploading && localUploadProgress?.progress && localUploadProgress?.estimated && (
                    <ProgressBar
                        progress={localUploadProgress.progress}
                        estimated={localUploadProgress.estimated}
                    />
                )}

                <ProgressBar
                    progress={0.55}
                    estimated={10}
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
    );
};

export default LocalFolderOptions;
