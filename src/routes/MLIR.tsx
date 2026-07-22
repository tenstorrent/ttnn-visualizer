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
import { activeMlirDataAtom, activeMlirJsonAtom } from '../store/app';
import type { GraphBundle } from '../model/MLIRJsonModel';
import { MLIRValidationError } from '../definitions/MLIRData';
import ROUTES from '../definitions/Routes';
import MlirJsonFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';
import MlirSplitView from '../components/mlir/MlirSplitView';
import MlirProcessingStatus from '../components/MlirProcessingStatus';
import { useMlir } from '../hooks/useAPI';
import getServerConfig from '../functions/getServerConfig';
import 'styles/components/MlirPage.scss';

const MLIR = () => {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const activeMlirData = useAtomValue(activeMlirDataAtom);
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);
    const [splitView, setSplitView] = useState(false);
    const [loaderExpanded, setLoaderExpanded] = useState(false);
    const [prevGraph, setPrevGraph] = useState<GraphBundle | null>(null);

    // On a fresh page load the in-memory graph is gone but the instance may
    // still reference a persisted MLIR report — fetch it back by name. Skip the
    // fetch when the graph is already in memory (e.g. just uploaded).
    const {
        data: restoredMlirData,
        isLoading,
        error: httpError,
    } = useMlir(isServerMode || activeMlirData ? null : mlirJsonFilename);
    const mlirData = activeMlirData ?? restoredMlirData ?? null;

    // Re-collapse the loader whenever the active graph changes, so a manual
    // reveal followed by loading/switching a file doesn't leave it open.
    // Adjusting state during render (not in an effect) avoids an extra commit.
    if (mlirData !== prevGraph) {
        setPrevGraph(mlirData);
        setLoaderExpanded(false);
    }

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
    }, [isLoading, httpError?.status, mlirJsonFilename, mlirData]);

    if (isServerMode) {
        return (
            <Navigate
                to={ROUTES.HOME}
                replace
            />
        );
    }

    const hasGraph = !!mlirData && errorCode === MLIRValidationError.OK;
    // Once a graph is up, the upload chrome collapses to reclaim vertical space;
    // the toggle reveals it to load/switch files. No graph yet → keep it open.
    const loaderVisible = !hasGraph || loaderExpanded;

    let graphContent;
    if (!mlirData || errorCode !== MLIRValidationError.OK) {
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
                data={mlirData}
                onExit={() => setSplitView(false)}
            />
        );
    } else {
        graphContent = (
            <div className='mlir-single-view'>
                <MlGraph data={mlirData} />
                <div className='mlir-view-toolbar'>
                    <Button
                        size={Size.SMALL}
                        variant={ButtonVariant.MINIMAL}
                        icon={IconNames.PANEL_STATS}
                        text='Split view'
                        onClick={() => setSplitView(true)}
                    />
                </div>
            </div>
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

            <div className={hasGraph ? 'mlir-page mlir-page-graph' : 'mlir-page'}>
                <h1 className='page-title'>MLIR model viewer</h1>

                {import.meta.env.DEV && (
                    <div className='mlir-loader-bar'>
                        {hasGraph && (
                            <Button
                                size={Size.SMALL}
                                variant={ButtonVariant.MINIMAL}
                                icon={loaderExpanded ? IconNames.CHEVRON_UP : IconNames.CHEVRON_DOWN}
                                text='Load / switch file'
                                aria-expanded={loaderExpanded}
                                onClick={() => setLoaderExpanded((open) => !open)}
                            />
                        )}
                        {loaderVisible && (
                            <div className='inline-loaders'>
                                <MlirJsonFileLoader />
                            </div>
                        )}
                    </div>
                )}

                {graphContent}
            </div>
        </>
    );
};

export default MLIR;
