import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import useLocalConnection from '../../hooks/useLocal';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { activeNpeAtom } from '../../store/app';
import createToastNotification from '../../functions/createToastNotification';
import 'styles/components/NPEFileLoader.scss';

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

const NPEFileLoader: React.FC = () => {
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const { uploadNpeFile } = useLocalConnection();
    const [npeFileName, setActiveNpe] = useAtom(activeNpeAtom);
    const [uploadStatus, setUploadStatus] = useState<ConnectionTestStates>(ConnectionTestStates.IDLE);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        setErrorMessage('Uploading...');
        setUploadStatus(ConnectionTestStates.PROGRESS);

        if (!event.target.files) {
            return;
        }

        const file = event.target.files?.[0];
        const response = await uploadNpeFile(event.target.files);

        if (response.status !== 200) {
            setUploadStatus(ConnectionTestStates.FAILED);
            setErrorMessage(response?.data?.message);
        } else if (response?.data?.status !== ConnectionTestStates.OK) {
            setUploadStatus(ConnectionTestStates.FAILED);
            setErrorMessage(response?.data?.message);
        } else {
            const fileName = file.name;
            setActiveNpe(fileName);
            createToastNotification('Active NPE', fileName);
            setUploadStatus(ConnectionTestStates.OK);
            setErrorMessage(`${fileName} uploaded successfully.`);
        }
    };

    return (
        <div className='npe-file-loader'>
            <label
                className='bp5-file-input'
                htmlFor='local-upload'
            >
                <input
                    id='local-upload'
                    type='file'
                    onChange={handleFileChange}
                />
                <span className='bp5-file-upload-input'>{npeFileName ?? 'Select NPE...'}</span>
            </label>

            {uploadStatus ? (
                <div className={`verify-connection-item status-${ConnectionTestStates[uploadStatus]}`}>
                    <Icon
                        className='connection-status-icon'
                        icon={ICON_MAP[uploadStatus]}
                        size={20}
                        intent={INTENT_MAP[uploadStatus]}
                    />

                    <span className='connection-status-text'>{errorMessage}</span>
                </div>
            ) : null}
        </div>
    );
};

export default NPEFileLoader;
