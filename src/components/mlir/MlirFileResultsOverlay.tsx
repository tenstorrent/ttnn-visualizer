// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, ButtonVariant, Classes, Icon, Intent, Tooltip } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import Overlay from '../Overlay';
import MlirFileList from './MlirFileList';
import { ConnectionTestStates } from '../../definitions/ConnectionStatus';
import { OVERLAY_HEADING_ICON_SIZE } from '../../definitions/UiConfig';
import ROUTES from '../../definitions/Routes';
import {
    activeMlirDataAtom,
    activeMlirJsonAtom,
    mlirFileResultsAtom,
    mlirFileResultsOpenAtom,
    mlirRetryFilesAtom,
    mlirRetryServerAtom,
} from '../../store/app';
import useMlirRemote from '../../hooks/useMlirRemote';
import createToastNotification, { ToastType } from '../../functions/createToastNotification';
import getResponseError from '../../functions/getResponseError';
import 'styles/components/MlirFileResultsOverlay.scss';

// Lists the per-file outcome of the most recent MLIR upload/load and lets the
// user pick which successfully-converted file to make the active graph.
// Visibility is controlled by `mlirFileResultsOpenAtom`; `mlirFileResultsAtom`
// holds the rows and is retained after closing so the overlay can be reopened.
// Selecting a file only highlights it; the View button commits the choice.
const MlirFileResultsOverlay = () => {
    const [results, setResults] = useAtom(mlirFileResultsAtom);
    const [isOpen, setIsOpen] = useAtom(mlirFileResultsOpenAtom);
    const retryFiles = useAtomValue(mlirRetryFilesAtom);
    const retryServer = useAtomValue(mlirRetryServerAtom);
    const setActiveMlirData = useSetAtom(activeMlirDataAtom);
    const setActiveMlirJson = useSetAtom(activeMlirJsonAtom);
    const { setActiveMlir, uploadMlirFileToServer } = useMlirRemote();
    const navigate = useNavigate();
    const location = useLocation();
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
    const [retryingIndex, setRetryingIndex] = useState<number | null>(null);

    // Reset the pending selection on close so it can't carry over to a reopen
    // or the next upload. The results themselves are retained so the overlay
    // can be reopened. Every close path — Close, View, escape/outside click —
    // routes through here.
    const handleClose = () => {
        setSelectedIndex(null);
        setRetryingIndex(null);
        setIsOpen(false);
    };

    const handleRetry = async (index: number) => {
        const result = results?.[index];
        const file = retryFiles?.[index];
        if (!result || result.status !== ConnectionTestStates.FAILED || !result.persisted || !file || !retryServer) {
            return;
        }

        setRetryingIndex(index);
        setResults(
            (current) =>
                current?.map((entry, entryIndex) =>
                    entryIndex === index
                        ? {
                              ...entry,
                              status: ConnectionTestStates.PROGRESS,
                              message: undefined,
                              name: null,
                              graph: null,
                          }
                        : entry,
                ) ?? current,
        );

        try {
            const response = await uploadMlirFileToServer([file], retryServer);
            const retried = response.data.results?.[0];
            if (!retried) {
                throw new Error('Upload failed');
            }

            setResults(
                (current) =>
                    current?.map((entry, entryIndex) =>
                        entryIndex === index
                            ? {
                                  filename: retried.filename,
                                  name: retried.name,
                                  status: retried.status,
                                  message: retried.message ?? retried.detail,
                                  graph: retried.graph ?? null,
                                  persisted: true,
                              }
                            : entry,
                    ) ?? current,
            );
        } catch (err: unknown) {
            const message = getResponseError(err, 'Unable to retry MLIR conversion');
            setResults(
                (current) =>
                    current?.map((entry, entryIndex) =>
                        entryIndex === index
                            ? {
                                  ...entry,
                                  status: ConnectionTestStates.FAILED,
                                  message,
                                  name: null,
                                  graph: null,
                              }
                            : entry,
                    ) ?? current,
            );
            createToastNotification('MLIR', message, ToastType.ERROR);
        } finally {
            setRetryingIndex(null);
        }
    };

    const handleView = async () => {
        const result = selectedIndex === null ? null : results?.[selectedIndex];
        if (!result?.graph || !result.name) {
            return;
        }

        setActiveMlirData(result.graph);
        setActiveMlirJson(result.name);

        // Local JSON loads live only in memory; only server uploads are stored
        // on disk and can be recorded as the instance's active MLIR so a reload
        // restores them.
        if (result.persisted) {
            try {
                await setActiveMlir(result.name);
            } catch (err: unknown) {
                createToastNotification('MLIR', getResponseError(err, 'Unable to set active MLIR'), ToastType.ERROR);
                return;
            }
        }

        createToastNotification('MLIR', result.filename, ToastType.SUCCESS);
        handleClose();

        if (location.pathname !== ROUTES.MLIR) {
            navigate(ROUTES.MLIR);
        }
    };

    return (
        <Overlay
            isOpen={isOpen && results !== null}
            onClose={handleClose}
            hideCloseButton
        >
            <div className='mlir-file-results-overlay'>
                <div className='close-button-anchor'>
                    <Tooltip content='Close'>
                        <Button
                            className='close-button'
                            variant={ButtonVariant.MINIMAL}
                            icon={IconNames.CROSS}
                            aria-label='Close'
                            onClick={handleClose}
                        />
                    </Tooltip>
                </div>

                <h2 className='heading'>
                    <Icon
                        icon={IconNames.LAYOUT}
                        size={OVERLAY_HEADING_ICON_SIZE}
                    />
                    MLIR uploads
                </h2>

                <MlirFileList
                    results={results ?? []}
                    selectedIndex={selectedIndex}
                    retryingIndex={retryingIndex}
                    // Clicking the already-selected file deselects it.
                    onSelect={(index) => setSelectedIndex((current) => (current === index ? null : index))}
                    onRetry={handleRetry}
                />
            </div>

            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Button
                    intent={Intent.PRIMARY}
                    disabled={selectedIndex === null}
                    onClick={handleView}
                >
                    View
                </Button>
            </div>
        </Overlay>
    );
};

export default MlirFileResultsOverlay;
