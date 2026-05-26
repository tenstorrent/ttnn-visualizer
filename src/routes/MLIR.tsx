// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { HttpStatusCode } from 'axios';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router';
import { useMLIR } from '../hooks/useAPI';
import { activeMlirJsonAtom } from '../store/app';
import { MLIRValidationError } from '../definitions/MLIRData';
import MlirJsonFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';
import MlirProcessingStatus from '../components/MlirProcessingStatus';

const MLIR = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);
    const { data: mlirData, isLoading, error: httpError } = useMLIR(filepath ? null : mlirJsonFilename);

    const hasUploadedFile = !!mlirJsonFilename || !!filepath;

    const errorCode = useMemo(() => {
        if (isLoading) {
            return MLIRValidationError.OK;
        }

        if (httpError?.status === HttpStatusCode.UnprocessableEntity) {
            return MLIRValidationError.INVALID_JSON;
        }

        if (httpError?.status !== undefined && httpError?.status >= HttpStatusCode.BadRequest) {
            return MLIRValidationError.DEFAULT;
        }

        return MLIRValidationError.OK;
    }, [isLoading, httpError?.status]);

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
            <div className='inline-loaders'>{!filepath && <MlirJsonFileLoader />}</div>

            {errorCode !== MLIRValidationError.OK ? (
                <MlirProcessingStatus
                    errorCode={errorCode}
                    isLoading={isLoading}
                    hasUploadedFile={hasUploadedFile}
                />
            ) : (
                mlirData && <MlGraph data={mlirData} />
            )}
        </>
    );
};

export default MLIR;
