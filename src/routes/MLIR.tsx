// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Helmet } from 'react-helmet-async';
import { useAtomValue } from 'jotai';
import { activeMLIRDataAtom, activeMlirJsonAtom } from '../store/app';
import { MLIRValidationError } from '../definitions/MLIRData';
import MlirJsonFileLoader from '../components/mlir/MlirJsonFileLoader';
import MlGraph from '../components/mlir/MLIRViewReactFlow';
import MlirProcessingStatus from '../components/MlirProcessingStatus';

const MLIR = () => {
    const mlirData = useAtomValue(activeMLIRDataAtom);
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);

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

            {/* Dev-only loader for already-processed MLIR JSON, bypassing the Model Explorer backend. */}
            {import.meta.env.DEV && (
                <div className='inline-loaders'>
                    <MlirJsonFileLoader />
                </div>
            )}

            {mlirData ? (
                <MlGraph data={mlirData} />
            ) : (
                <MlirProcessingStatus
                    errorCode={MLIRValidationError.OK}
                    isLoading={false}
                    hasUploadedFile={!!mlirJsonFilename}
                />
            )}
        </>
    );
};

export default MLIR;
