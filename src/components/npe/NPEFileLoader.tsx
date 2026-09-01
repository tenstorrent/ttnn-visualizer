// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import React, { useState } from 'react';
import { useAtom } from 'jotai';
import { type QueryFilters, useQueryClient } from '@tanstack/react-query';
import { FileInput, FormGroup, Icon, IconName, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import useLocalConnection from '../../hooks/useLocal';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { NPE_QUERY_KEY, NPE_SUMMARY_QUERY_KEY, NPE_WINDOW_QUERY_KEY } from '../../definitions/NPEData';
import { activeNpeOpTraceAtom } from '../../store/app';
import createToastNotification from '../../functions/createToastNotification';
import { ToastType } from '../../definitions/ToastType';
import getResponseError from '../../functions/getResponseError';
import sanitiseFileName from '../../functions/sanitiseFileName';
import { ReportKind, ReportLoadFailureReason } from '../../definitions/UsageEvent';
import { getReportLoadFailureReason, recordReportLoadFailed } from '../../functions/reportLoadUsage';
import 'styles/components/FileLoader.scss';

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

const NPE_QUERY_KEYS = new Set<string>([NPE_SUMMARY_QUERY_KEY, NPE_WINDOW_QUERY_KEY, NPE_QUERY_KEY]);
const NPE_QUERY_FILTER: QueryFilters<readonly unknown[]> = {
    predicate: (query) => NPE_QUERY_KEYS.has(String(query.queryKey[0])),
};

interface NPEFileLoaderProps {
    onUploadAccepted: (fileName: string) => void;
}

const NPEFileLoader = ({ onUploadAccepted }: NPEFileLoaderProps) => {
    const [statusMessage, setStatusMessage] = useState<string | null>(null);
    const { uploadNpeFile } = useLocalConnection();
    const queryClient = useQueryClient();
    const [npeFileName, setActiveNpe] = useAtom(activeNpeOpTraceAtom);
    const [uploadStatus, setUploadStatus] = useState<ConnectionTestStates>(ConnectionTestStates.IDLE);

    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        if (!event.target.files?.length) {
            return;
        }

        setStatusMessage('Uploading...');
        setUploadStatus(ConnectionTestStates.PROGRESS);

        const file = event.target.files?.[0];

        try {
            const response = await uploadNpeFile(event.target.files);

            if (response?.data?.status !== ConnectionTestStates.OK) {
                setUploadStatus(ConnectionTestStates.FAILED);
                setStatusMessage(response?.data?.message ?? 'Upload failed');
                recordReportLoadFailed(ReportKind.NPE, ReportLoadFailureReason.OTHER);
            } else {
                const fileName = file.name;
                // Re-uploading a same-named file reuses the NPE query keys, and the
                // windowed hooks are staleTime: Infinity — drop the cached summary /
                // windows so the freshly-rebuilt server index is refetched instead of
                // serving the previous report's data.
                await queryClient.cancelQueries(NPE_QUERY_FILTER);
                queryClient.removeQueries(NPE_QUERY_FILTER);
                const sanitisedFileName = sanitiseFileName(fileName);
                onUploadAccepted(sanitisedFileName);
                setActiveNpe(sanitisedFileName);
                createToastNotification('Active NPE', fileName, ToastType.SUCCESS);
                setUploadStatus(ConnectionTestStates.OK);
                setStatusMessage(`${fileName} uploaded successfully`);
            }
        } catch (err: unknown) {
            setUploadStatus(ConnectionTestStates.FAILED);
            setStatusMessage(getResponseError(err, 'Unable to upload file'));
            recordReportLoadFailed(ReportKind.NPE, getReportLoadFailureReason(err));
        }
    };

    return (
        <FormGroup className='file-loader'>
            <div className='form-container'>
                <FileInput
                    text={npeFileName ?? 'Upload an NPE report file for analysis...'}
                    onInputChange={handleFileChange}
                />

                <div className='folder-upload-status'>
                    {uploadStatus ? (
                        <>
                            <Icon
                                icon={ICON_MAP[uploadStatus]}
                                size={20}
                                intent={INTENT_MAP[uploadStatus]}
                            />

                            <span className='message'>{statusMessage}</span>
                        </>
                    ) : null}
                </div>
            </div>
        </FormGroup>
    );
};

export default NPEFileLoader;
