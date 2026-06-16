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
import { useMLIR } from '../hooks/useAPI';

const MLIR = () => {
    const activeMlirData = useAtomValue(activeMLIRDataAtom);
    const mlirJsonFilename = useAtomValue(activeMlirJsonAtom);

    // On a fresh page load the in-memory graph is gone but the instance may
    // still reference a persisted MLIR report — fetch it back by name. Skip the
    // fetch when the graph is already in memory (e.g. just uploaded).
    const { data: restoredMlirData, isLoading } = useMLIR(activeMlirData ? null : mlirJsonFilename);
    const mlirData = activeMlirData ?? restoredMlirData ?? null;

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
                    isLoading={isLoading}
                    hasUploadedFile={!!mlirJsonFilename}
                />
            )}
        </>
    );
};

export default MLIR;
