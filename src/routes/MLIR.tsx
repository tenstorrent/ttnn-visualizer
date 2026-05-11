// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { HttpStatusCode } from 'axios';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router';
import { useMLIR } from '../hooks/useAPI';
import { activeMlirJsonAtom } from '../store/app';
import MLIRJSONFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';

enum ValidationError {
    OK,
    DEFAULT,
    INVALID_JSON,
}

const MLIR: FC = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);
    const { data: mlirData, isLoading, error: httpError } = useMLIR(filepath ? null : mlirJsonFilename);

    const errorCode = useMemo(() => {
        if (isLoading) {
            return ValidationError.OK;
        }

        if (httpError?.status === HttpStatusCode.UnprocessableEntity) {
            return ValidationError.INVALID_JSON;
        }

        if (httpError?.status !== undefined && httpError?.status >= HttpStatusCode.BadRequest) {
            return ValidationError.DEFAULT;
        }

        return ValidationError.OK;
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
            <div className='npe-inline-loaders'>{!filepath && <MLIRJSONFileLoader />}</div>

            {errorCode !== ValidationError.OK ? <div>{errorCode}</div> : mlirData && <MlGraph data={mlirData} />}
        </>
    );
};

export default MLIR;
