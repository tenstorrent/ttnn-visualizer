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
import { activeMlirDataAtom, activeMlirJsonAtom, mlirFileResultsAtom, mlirFileResultsOpenAtom } from '../../store/app';
import useMlirRemote from '../../hooks/useMlirRemote';
import createToastNotification, { ToastType } from '../../functions/createToastNotification';
import getResponseError from '../../functions/getResponseError';
import 'styles/components/MlirFileResultsOverlay.scss';

// Lists the per-file outcome of the most recent MLIR upload/load and lets the
// user pick which successfully-converted file to make the active graph. Driven
// by `mlirFileResultsAtom`: a non-null value opens the overlay, clearing it
// closes the overlay. Selecting a file only highlights it; the View button
// commits the choice.
const MlirFileResultsOverlay = () => {
    const results = useAtomValue(mlirFileResultsAtom);
    const [isOpen, setIsOpen] = useAtom(mlirFileResultsOpenAtom);
    const setActiveMlirData = useSetAtom(activeMlirDataAtom);
    const setActiveMlirJson = useSetAtom(activeMlirJsonAtom);
    const { setActiveMlir } = useMlirRemote();
    const navigate = useNavigate();
    const location = useLocation();
    const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

    // Reset the pending selection on close so it can't carry over to a reopen
    // or the next upload. The results themselves are retained so the overlay
    // can be reopened. Every close path — Close, View, escape/outside click —
    // routes through here.
    const handleClose = () => {
        setSelectedIndex(null);
        setIsOpen(false);
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
            }
        }

        createToastNotification('MLIR', result.filename, ToastType.SUCCESS);
        handleClose();

        if (location.pathname !== ROUTES.MLIR) {
            navigate(ROUTES.MLIR);
        }
    };

    const successCount = results?.filter((result) => result.status === ConnectionTestStates.OK).length ?? 0;

    return (
        <Overlay
            isOpen={isOpen && results !== null}
            onClose={handleClose}
            hideCloseButton
        >
            <div className='mlir-file-results-overlay'>
                <Tooltip content='Close'>
                    <Button
                        className='close-button'
                        variant={ButtonVariant.MINIMAL}
                        icon={IconNames.CROSS}
                        aria-label='Close'
                        onClick={handleClose}
                    />
                </Tooltip>

                <h2 className='heading'>
                    <Icon
                        icon={IconNames.LAYOUT}
                        size={OVERLAY_HEADING_ICON_SIZE}
                    />
                    MLIR upload results
                </h2>

                <p>
                    {successCount > 0
                        ? 'Select a file to make it the active MLIR graph.'
                        : 'No files could be processed.'}
                </p>

                <MlirFileList
                    results={results ?? []}
                    selectedIndex={selectedIndex}
                    onSelect={setSelectedIndex}
                />
            </div>

            <div className={Classes.DIALOG_FOOTER_ACTIONS}>
                <Button
                    intent={Intent.PRIMARY}
                    icon={IconNames.EYE_OPEN}
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
