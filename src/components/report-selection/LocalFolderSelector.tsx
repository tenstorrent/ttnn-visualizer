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

    const { uploadLocalFolder } = useLocalConnection();
    const [folderStatus, setFolderStatus] = useState<ConnectionStatus | undefined>();
    const [isUploading, setIsUploading] = useState(false);
    const [localUploadLabel, setLocalUploadLabel] = useState('Choose directory...');

    const isLocalReportMounted = !isUploading && reportLocation === 'local';

    /**
     * This is a temporrary solution until we support Safari
     */
    const ua = navigator.userAgent.toLowerCase();
    const isSafari = ua.includes('safari') && !ua.includes('chrome') && !ua.includes('android');

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
        setReportLocation('local');
    };

    const viewOperation = () => {
        queryClient.clear();

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

                    {/* TODO This should live higher in the component stack maybe */}
                    <FileStatusOverlay />
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
