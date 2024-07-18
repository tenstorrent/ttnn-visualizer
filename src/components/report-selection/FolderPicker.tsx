// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent AI ULC

import { IconName, IconNames } from '@blueprintjs/icons';
import { Button, Icon, Intent } from '@blueprintjs/core';
import { FileWithDirectoryAndFileHandle, directoryOpen } from 'browser-fs-access';
import React, { useState } from 'react';

import 'styles/components/FolderPicker.scss';
import { ConnectionStatus, ConnectionTestStates } from '../../hooks/useRemote';

const OPEN_FOLDER_OPTIONS = {
    recursive: false,
    id: 'projects',
};

interface LocalFile extends FileWithDirectoryAndFileHandle {
    webkitRelativePath: string;
}

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

const FolderPicker = (): React.ReactElement => {
    const [status, setStatus] = useState<ConnectionTestStates | undefined>();
    const [message, setMessage] = useState<string | undefined>();

    const handleDirectoryOpen = async () => {
        const files = (await directoryOpen(OPEN_FOLDER_OPTIONS)) as LocalFile[];
        const connectionStatus: ConnectionStatus = {
            status: ConnectionTestStates.FAILED,
            message: 'Some kind of error with this',
        };

        // TODO: Confirm this is the correct way to POST files
        // let response = await axios.post('/api/local/directory', files, {
        //     headers: {
        //         'Content-Type': 'multipart/form-data',
        //     },
        // });

        const response = {
            status: 200,
            message: 'all good chum',
        };

        if (response.status === 200) {
            connectionStatus.status = ConnectionTestStates.OK;
            connectionStatus.message = 'Files uploaded successful';
        }

        // TODO: Handle other errors more betterly

        setStatus(connectionStatus.status);
        setMessage(connectionStatus.message);
    };

    return (
        <>
            <Button onClick={handleDirectoryOpen}>Open Directory</Button>
            {status && message && (
                <div className={`verify-connection-item status-${ConnectionTestStates[status]}`}>
                    <Icon
                        className='connection-status-icon'
                        icon={ICON_MAP[status]}
                        size={20}
                        intent={INTENT_MAP[status]}
                    />
                    <span className='connection-status-text'>{message}</span>
                </div>
            )}
        </>
    );
};

export default FolderPicker;
