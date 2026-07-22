// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useMemo, useState } from 'react';
import { Navigate } from 'react-router';
import { useAtomValue, useSetAtom } from 'jotai';
import { HttpStatusCode } from 'axios';
import { Button, ButtonVariant, Size } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import {
    activeMlirDataAtom,
    activeMlirJsonAtom,
    comparisonMlirDataAtom,
    comparisonMlirJsonAtom,
    setComparisonMlirAtom,
} from '../store/app';
import { MLIRValidationError } from '../definitions/MLIRData';
import ROUTES from '../definitions/Routes';
import MlirJsonFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';
import MlirSplitView from '../components/mlir/MlirSplitView';
import MlirProcessingStatus from '../components/MlirProcessingStatus';
import { useMlir } from '../hooks/useAPI';
import getServerConfig from '../functions/getServerConfig';

const MLIR = () => {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const activeMlirData = useAtomValue(activeMlirDataAtom);
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);
    const comparisonMlirData = useAtomValue(comparisonMlirDataAtom);
    const comparisonMlirJson = useAtomValue(comparisonMlirJsonAtom);
    const setComparisonMlir = useSetAtom(setComparisonMlirAtom);
    // In-file split only; cross-file split is derived from comparisonMlirData.
    const [inFileSplitView, setInFileSplitView] = useState(false);

    // On a fresh page load the in-memory graph is gone but the instance may
    // still reference a persisted MLIR report — fetch it back by name. Skip the
    // fetch when the graph is already in memory (e.g. just uploaded).
    const {
        data: restoredMlirData,
        isLoading,
        error: httpError,
    } = useMlir(isServerMode || activeMlirData ? null : mlirJsonFilename);
    const mlirData = activeMlirData ?? restoredMlirData ?? null;

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

    let graphContent;
    if (!mlirData || errorCode !== MLIRValidationError.OK) {
        graphContent = (
            <MlirProcessingStatus
                errorCode={errorCode}
                isLoading={isLoading}
                hasUploadedFile={!!mlirJsonFilename}
            />
        );
    } else if (comparisonMlirData) {
        graphContent = (
            <MlirSplitView
                leftData={mlirData}
                rightData={comparisonMlirData}
                leftLabel={mlirJsonFilename}
                rightLabel={comparisonMlirJson}
                onExit={() => setComparisonMlir(null)}
            />
        );
    } else if (inFileSplitView) {
        graphContent = (
            <MlirSplitView
                leftData={mlirData}
                rightData={mlirData}
                onExit={() => setInFileSplitView(false)}
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
                        onClick={() => setInFileSplitView(true)}
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
