// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect, useRef, useState } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { useLocation, useNavigate } from 'react-router-dom';
import axios from 'axios';
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
import createToastNotification from '../../functions/createToastNotification';
import { ToastType } from '../../definitions/ToastType';
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
    const [retryingIndices, setRetryingIndices] = useState<Set<number>>(new Set<number>());
    const retrySessionRef = useRef(0);
    const retryAbortControllersRef = useRef<Map<number, AbortController>>(new Map<number, AbortController>());

    // Abort all in-flight retries on unmount to prevent setResults writebacks
    // on unmounted tree. Complements the axios.isCancel guard in the catch block.
    useEffect(
        () => () => {
            retryAbortControllersRef.current.forEach((c) => c.abort());
            retryAbortControllersRef.current.clear();
        },
        [],
    );

    // Reset the pending selection on close so it can't carry over to a reopen
    // or the next upload. The results themselves are retained so the overlay
    // can be reopened. Every close path — Close, View, escape/outside click —
    // routes through here.
    const handleClose = () => {
        retrySessionRef.current += 1;
        const cancelledRetryIndices = Array.from(retryAbortControllersRef.current.keys());
        retryAbortControllersRef.current.forEach((controller) => controller.abort());
        retryAbortControllersRef.current.clear();
        if (cancelledRetryIndices.length > 0) {
            const cancelledRetryIndicesSet = new Set(cancelledRetryIndices);
            const cancelledRetryCount = cancelledRetryIndices.length;
            setResults(
                (current) =>
                    current?.map((entry, entryIndex) =>
                        cancelledRetryIndicesSet.has(entryIndex) && entry.status === ConnectionTestStates.PROGRESS
                            ? {
                                  ...entry,
                                  status: ConnectionTestStates.FAILED,
                                  message: 'Retry cancelled',
                                  name: null,
                                  graph: null,
                              }
                            : entry,
                    ) ?? current,
            );
            createToastNotification(
                'MLIR',
                `Aborted ${cancelledRetryCount}x MLIR conversion${cancelledRetryCount === 1 ? '' : 's'}`,
                ToastType.WARNING,
            );
        }
        setSelectedIndex(null);
        setRetryingIndices(new Set<number>());
        setIsOpen(false);
    };

    const handleRetry = async (index: number) => {
        const result = results?.[index];
        const file = retryFiles?.[index];
        if (
            !result ||
            result.status !== ConnectionTestStates.FAILED ||
            !result.persisted ||
            retryAbortControllersRef.current.has(index)
        ) {
            return;
        }

        if (!file || !retryServer) {
            createToastNotification(
                'MLIR',
                'Retry context missing. Re-upload the file and try again.',
                ToastType.ERROR,
            );
            return;
        }

        const retrySession = retrySessionRef.current;
        const abortController = new AbortController();
        retryAbortControllersRef.current.set(index, abortController);
        setRetryingIndices((current) => {
            const next = new Set(current);
            next.add(index);
            return next;
        });
        setResults(
            (current) =>
                current?.map((entry, entryIndex) =>
                    entryIndex === index
                        ? {
                              ...entry,
                              status: ConnectionTestStates.PROGRESS,
                              name: null,
                              graph: null,
                          }
                        : entry,
                ) ?? current,
        );

        try {
            const response = await uploadMlirFileToServer([file], retryServer, {
                signal: abortController.signal,
                suppressProgressOverlay: true,
            });
            const retried = response.data.results?.[0];
            if (!retried) {
                throw new Error('Upload failed');
            }

            if (retrySessionRef.current !== retrySession) {
                return;
            }

            setResults(
                (current) =>
                    current?.map((entry, entryIndex) =>
                        entryIndex === index
                            ? {
                                  filename: retried.filename,
                                  host: retried.host ?? entry.host ?? null,
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
            // Skip writeback for user-triggered aborts (close, unmount, or per-row cancel).
            // The abort → cancel error contract is explicit here rather than relying on retrySessionRef.
            if (axios.isCancel(err)) {
                return;
            }

            if (retrySessionRef.current !== retrySession) {
                return;
            }

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
            // Only delete the controller if it matches the one we stored for this retry.
            // Prevents a stale (completed) retry's finally block from evicting a new controller
            // if the same row is retried after an overlay close/reopen.
            if (retryAbortControllersRef.current.get(index) === abortController) {
                retryAbortControllersRef.current.delete(index);
            }

            if (retrySessionRef.current === retrySession) {
                setRetryingIndices((current) => {
                    const next = new Set(current);
                    next.delete(index);
                    return next;
                });
            }
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
                await setActiveMlir(result.name, result.host);
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
                    retryingIndices={retryingIndices}
                    // Clicking the already-selected file deselects it.
                    onSelect={(index) => setSelectedIndex((current) => (current === index ? null : index))}
                    onRetry={handleRetry}
                    canRetry={(index) => !!retryServer && !!retryFiles?.[index]}
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
