// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { FC, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { HttpStatusCode } from 'axios';
import { useAtomValue } from 'jotai';
import { useParams } from 'react-router';
import { useNpe } from '../hooks/useAPI';
import { NPEValidationError } from '../definitions/NPEData';
import { activeMlirJsonAtom } from '../store/app';
import MLIRJSONFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';

const MLIR: FC = () => {
    const { filepath } = useParams<{ filepath?: string }>();
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);
    const { data: npeData, isLoading, error: httpError } = useNpe(filepath ? null : mlirJsonFilename);

    // const hasUploadedFile = !!mlirJsonFilename;

    const errorCode = useMemo(() => {
        if (isLoading) {
            return NPEValidationError.OK;
        }

        if (httpError?.status === HttpStatusCode.UnprocessableEntity) {
            return NPEValidationError.INVALID_JSON;
        }

        if (httpError?.status !== undefined && httpError?.status >= HttpStatusCode.BadRequest) {
            return NPEValidationError.DEFAULT;
        }

        return NPEValidationError.OK;
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

            {/* {errorCode !== NPEValidationError.OK ? { errorCode } : npeData && <MLIRView data={npeData} />} */}
            {errorCode !== NPEValidationError.OK ? { errorCode } : npeData && <MlGraph data={npeData} />}
        </>
    );
};

export default MLIR;
