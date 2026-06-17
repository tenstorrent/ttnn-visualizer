// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useMemo } from 'react';
import { Navigate } from 'react-router';
import { useAtomValue } from 'jotai';
import { HttpStatusCode } from 'axios';
import { activeMlirDataAtom, activeMlirJsonAtom } from '../store/app';
import { MLIRValidationError } from '../definitions/MLIRData';
import ROUTES from '../definitions/Routes';
import MlirJsonFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';
import MlirProcessingStatus from '../components/MlirProcessingStatus';
import { useMlir } from '../hooks/useAPI';
import getServerConfig from '../functions/getServerConfig';

const MLIR = () => {
    const isServerMode = !!getServerConfig()?.SERVER_MODE;
    const activeMlirData = useAtomValue(activeMlirDataAtom);
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);

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

            <div className='inline-loaders'>
                <MlirJsonFileLoader />
            </div>

            {mlirData && errorCode === MLIRValidationError.OK ? (
                <MlGraph data={mlirData} />
            ) : (
                <MlirProcessingStatus
                    errorCode={errorCode}
                    isLoading={isLoading}
                    hasUploadedFile={!!mlirJsonFilename}
                />
            )}
        </>
    );
};

export default MLIR;
