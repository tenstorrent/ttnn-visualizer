// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { Button, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { type FC, useEffect, useState } from 'react';

import 'styles/components/FolderPicker.scss';
import { useNavigate } from 'react-router';
import { useQueryClient } from 'react-query';
import ROUTES from '../../definitions/routes';
import useLocalConnection from '../../hooks/useLocal';
import LoadingSpinner from '../LoadingSpinner';
import { LoadingSpinnerSizes } from '../../definitions/LoadingSpinner';
import { ConnectionStatus, ConnectionTestStates } from '../../definitions/ConnectionStatus';

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

    const { uploadLocalFolder, selectDirectory } = useLocalConnection();
    const [folderStatus, setFolderStatus] = useState<ConnectionStatus | undefined>();
    const [isUploading, setIsUploading] = useState(false);

    const handleDirectoryOpen = async () => {
        const files = await selectDirectory();
        const connectionStatus: ConnectionStatus = {
            status: ConnectionTestStates.OK,
            message: 'Files uploaded successfully',
        };

        setIsUploading(true);

        const response = await uploadLocalFolder(files);

        if (response.status !== 200) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Unable to upload selected directory.';
        }

        if (response.data.status !== 200) {
            connectionStatus.status = ConnectionTestStates.FAILED;
            connectionStatus.message = 'Selected directory does not contain a valid report.';
        }

        setIsUploading(false);
        setFolderStatus(connectionStatus);
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
        <FormGroup
            label={<h3>Select local report</h3>}
            labelFor='text-input'
            subLabel='Select a local directory containing a report'
        >
            <div className='buttons-container'>
                <Button
                    onClick={handleDirectoryOpen}
                    icon={IconNames.FOLDER_OPEN}
                >
                    Open Directory
                </Button>

                <Button
                    disabled={folderStatus?.status !== ConnectionTestStates.OK}
                    onClick={viewOperation}
                    icon={IconNames.EYE_OPEN}
                >
                    View report
                </Button>

                {isUploading && <LoadingSpinner size={LoadingSpinnerSizes.SMALL} />}

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
