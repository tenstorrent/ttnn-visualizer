// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { useAtomValue } from 'jotai';
import { HttpStatusCode } from 'axios';
import { Button, ButtonVariant, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { mlirLoadedReportsAtom, mlirSplitViewEpochAtom } from '../store/app';
import { MLIRValidationError } from '../definitions/MLIRData';
import ROUTES from '../definitions/Routes';
import MlirJsonFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';
import MlirSplitView, { type MlirSplitReport } from '../components/mlir/MlirSplitView';
import MlirProcessingStatus from '../components/MlirProcessingStatus';
import { useMlir } from '../hooks/useAPI';
import getServerConfig from '../functions/getServerConfig';

const MLIR = () => {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const loadedReports = useAtomValue(mlirLoadedReportsAtom);
    const splitViewEpoch = useAtomValue(mlirSplitViewEpochAtom);
    const primaryReport = loadedReports[0] ?? null;
    const peerReport = loadedReports[1] ?? null;
    const mlirJsonFilename = primaryReport?.name ?? null;
    const activeMlirData = primaryReport?.data ?? null;
    // Toolbar / explicit open. Auto-open from a two-file View is separate so
    // closing split can dismiss without dropping the peer report.
    const [manualSplitView, setManualSplitView] = useState(false);
    const [dismissedSplitEpoch, setDismissedSplitEpoch] = useState<number | null>(null);

    // On a fresh page load the in-memory graph is gone but the instance may
    // still reference a persisted MLIR report — fetch it back by name. Skip the
    // fetch when the graph is already in memory (e.g. just uploaded).
    const {
        data: restoredMlirData,
        isLoading,
        error: httpError,
    } = useMlir(isServerMode || activeMlirData ? null : mlirJsonFilename);
    const mlirData = activeMlirData ?? restoredMlirData ?? null;

    const reports = useMemo<MlirSplitReport[]>(() => {
        const list: MlirSplitReport[] = [];
        if (mlirData) {
            const key = mlirJsonFilename ?? mlirData.graphs[0]?.id ?? 'primary';
            list.push({ key, label: key, data: mlirData });
        }
        if (peerReport?.data) {
            list.push({ key: peerReport.name, label: peerReport.name, data: peerReport.data });
        }
        return list;
    }, [mlirData, mlirJsonFilename, peerReport]);

    const errorCode = useMemo(() => {
        if (isLoading) {
            return MLIRValidationError.OK;
        }

        if (httpError?.status === HttpStatusCode.UnprocessableEntity) {
            return MLIRValidationError.INVALID_JSON;
        }

        if (httpError?.status !== undefined && httpError.status >= HttpStatusCode.BadRequest) {
            return MLIRValidationError.DEFAULT;
        }

        if (mlirJsonFilename && !mlirData) {
            return MLIRValidationError.DEFAULT;
        }

        return MLIRValidationError.OK;
    }, [isLoading, httpError, mlirJsonFilename, mlirData]);

    const peerKey = peerReport?.name ?? null;
    const autoSplitView = !!peerReport?.data && peerKey !== null && dismissedSplitEpoch !== splitViewEpoch;
    const splitView = manualSplitView || autoSplitView;

    if (isServerMode) {
        return (
            <Navigate
                to={ROUTES.HOME}
                replace
            />
        );
    }

    const handleExitSplit = () => {
        setManualSplitView(false);
        if (peerKey) {
            setDismissedSplitEpoch(splitViewEpoch);
        }
    };

    let graphContent;
    if (!mlirData || errorCode !== MLIRValidationError.OK || reports.length === 0) {
        graphContent = (
            <MlirProcessingStatus
                errorCode={errorCode}
                isLoading={isLoading}
                hasUploadedFile={!!mlirJsonFilename}
            />
        );
    } else if (splitView) {
        graphContent = (
            <MlirSplitView
                key={reports.map((report) => report.key).join('|')}
                reports={reports}
                initialLeftKey={reports[0].key}
                initialRightKey={reports[reports.length > 1 ? 1 : 0].key}
                onExit={handleExitSplit}
            />
        );
    } else {
        graphContent = (
            <>
                <div className='mlir-view-toolbar'>
                    <Button
                        size={Size.SMALL}
                        variant={ButtonVariant.MINIMAL}
                        icon={IconNames.PANEL_STATS}
                        text='Split view'
                        onClick={() => setManualSplitView(true)}
                    />
                </div>
                <MlGraph data={mlirData} />
            </>
        );
    }

    return (
        <>
            <Helmet>
                <title>MLIR</title>
                <meta
                    name='description'
                    content='MLIR model viewer'
                />
            </Helmet>

            <h1 className='page-title'>MLIR model viewer</h1>

            {import.meta.env.DEV && (
                <div className='inline-loaders'>
                    <MlirJsonFileLoader />
                </div>
            )}

            {graphContent}
        </>
    );
};

export default MLIR;
