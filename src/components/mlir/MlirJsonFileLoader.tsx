// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { FileInput, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import useLocalConnection from '../../hooks/useLocal';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { activeMlirJsonAtom } from '../../store/app';
import createToastNotification, { ToastType } from '../../functions/createToastNotification';
import getResponseError from '../../functions/getResponseError';
import sanitiseFileName from '../../functions/sanitiseFileName';
import 'styles/components/FileLoader.scss';

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

const MlirJsonFileLoader: React.FC = () => {
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { uploadMlirFile } = useLocalConnection();
    const [mlirJsonFileName, setMlirJsonFileName] = useAtom(activeMlirJsonAtom);
    const [uploadStatus, setUploadStatus] = useState<ConnectionTestStates>(ConnectionTestStates.IDLE);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        // Guard *before* mutating state so cancelling the OS file dialog
        // (which fires `change` with an empty `files` list) leaves the
        // component in its previous state instead of stuck at PROGRESS.
        if (!event.target.files?.length) {
            return;
        }

        setErrorMessage('Uploading...');
        setUploadStatus(ConnectionTestStates.PROGRESS);

        const file = event.target.files[0];

        try {
            const response = await uploadMlirFile(event.target.files);

            if (response?.data?.status !== ConnectionTestStates.OK) {
                setUploadStatus(ConnectionTestStates.FAILED);
                setErrorMessage(response?.data?.message ?? 'Upload failed');
            } else {
                const fileName = file.name;
                setMlirJsonFileName(sanitiseFileName(fileName));
                createToastNotification('MLIR', fileName, ToastType.SUCCESS);
                setUploadStatus(ConnectionTestStates.OK);
                setErrorMessage(`${fileName} uploaded successfully`);
            }
        } catch (err: unknown) {
            setUploadStatus(ConnectionTestStates.FAILED);
            setErrorMessage(getResponseError(err, 'Unable to upload MLIR file'));
        }
    };

    return (
        <div className='file-loader'>
            <FileInput
                text={mlirJsonFileName ?? 'Upload an MLIR JSON'}
                onInputChange={handleFileChange}
            />

            <div className={`verify-connection-item status-${ConnectionTestStates[uploadStatus]}`}>
                {uploadStatus ? (
                    <>
                        <Icon
                            className='connection-status-icon'
                            icon={ICON_MAP[uploadStatus]}
                            size={20}
                            intent={INTENT_MAP[uploadStatus]}
                        />

                        <span className='connection-status-text'>{errorMessage}</span>
                    </>
                ) : null}
            </div>
        </div>
    );
};

export default MlirJsonFileLoader;
