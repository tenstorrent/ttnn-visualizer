// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import 'styles/components/MlirProcessingStatus.scss';
import { MLIRValidationError } from '../definitions/MLIRData';
import LoadingSpinner from './LoadingSpinner';

const SHARED_PROPS = {
    className: 'mlir-processing-status',
    compact: true,
};

const ProcessingErrors: Record<MLIRValidationError, { title: string }> = {
    [MLIRValidationError.OK]: {
        title: '',
    },
    [MLIRValidationError.DEFAULT]: {
        title: 'Unable to load MLIR data',
    },
    [MLIRValidationError.INVALID_JSON]: {
        title: 'Unable to process JSON',
    },
};

interface MlirProcessingStatusProps {
    errorCode: MLIRValidationError;
    isLoading: boolean;
    hasUploadedFile?: boolean;
}

const MlirProcessingStatus = ({ errorCode, isLoading, hasUploadedFile }: MlirProcessingStatusProps) => {
    if (isLoading) {
        return (
            <div>
                <LoadingSpinner />
            </div>
        );
    }

    if (!hasUploadedFile) {
        return <Callout {...SHARED_PROPS}>Upload an MLIR JSON file to view the model graph.</Callout>;
    }

    return (
        <Callout
            {...SHARED_PROPS}
            intent={Intent.WARNING}
            title={ProcessingErrors?.[errorCode]?.title}
        >
            {errorCode === MLIRValidationError.INVALID_JSON ? (
                <p>The uploaded file is not a valid MLIR JSON.</p>
            ) : (
                <p>An unknown error occurred while loading the MLIR data.</p>
            )}
        </Callout>
    );
};

export default MlirProcessingStatus;
