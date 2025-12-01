/* eslint-disable react/jsx-props-no-spreading */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import 'styles/components/NPEProcessingStatus.scss';
import { LEGACY_VISUALIZER_VERSION, MIN_SUPPORTED_VERSION, NPEValidationError } from '../definitions/NPEData';
import { TEST_IDS } from '../definitions/TestIds';
import LoadingSpinner from './LoadingSpinner';

const NPE_REPO_URL = (
    <a
        target='_blank'
        href='https://github.com/tenstorrent/tt-npe'
        rel='noreferrer'
    >
        tt-npe
    </a>
);

const SHARED_PROPS = {
    className: 'npe-processing-status',
    compact: true,
};

const ProcessingErrors: Record<NPEValidationError, { title: string }> = {
    [NPEValidationError.OK]: {
        title: '',
    },
    [NPEValidationError.DEFAULT]: {
        title: 'Unknown error',
    },
    [NPEValidationError.INVALID_NPE_VERSION]: {
        title: 'Invalid NPE version',
    },
    [NPEValidationError.INVALID_JSON]: {
        title: 'Unable to process JSON',
    },
    [NPEValidationError.INVALID_NPE_DATA]: {
        title: 'Invalid NPE data',
    },
};

interface NPEProcessingStatusProps {
    dataVersion: string | null;
    hasUploadedFile?: boolean;
    errorType: NPEValidationError;
    isLoading: boolean;
}

const NPEProcessingStatus = ({ dataVersion, hasUploadedFile, errorType, isLoading }: NPEProcessingStatusProps) => {
    if (isLoading) {
        return (
            <div>
                <LoadingSpinner />
            </div>
        );
    }

    if (!hasUploadedFile) {
        return (
            <Callout
                data-testid={TEST_IDS.NPE_PROCESSING_INITIAL}
                {...SHARED_PROPS}
            >
                See {NPE_REPO_URL} for details on how to generate NPE report files.
            </Callout>
        );
    }

    return (
        <Callout
            {...SHARED_PROPS}
            intent={Intent.WARNING}
            title={ProcessingErrors?.[errorType]?.title}
        >
            {(() => {
                switch (errorType) {
                    case NPEValidationError.INVALID_NPE_DATA:
                        return (
                            <>
                                <p data-testid={TEST_IDS.NPE_PROCESSING_INVALID_DATA}>
                                    Unable to validate uploaded NPE data.
                                </p>
                                <p>Use {NPE_REPO_URL} to generate a new dataset.</p>
                            </>
                        );
                    case NPEValidationError.INVALID_NPE_VERSION:
                        return (
                            <>
                                <p data-testid={TEST_IDS.NPE_PROCESSING_INVALID_VERSION}>
                                    Current supported version is <u>{MIN_SUPPORTED_VERSION}</u>, uploaded data version
                                    is <u>{dataVersion || 'null'}</u>.
                                </p>

                                <p>
                                    Use {NPE_REPO_URL} to generate new NPE dataset or install an older version of the
                                    visualizer{' '}
                                    <code className='formatted-code'>
                                        pip install ttnn-visualizer=={LEGACY_VISUALIZER_VERSION}
                                    </code>
                                </p>
                            </>
                        );
                    case NPEValidationError.INVALID_JSON:
                        return (
                            <>
                                <p data-testid={TEST_IDS.NPE_PROCESSING_INVALID_JSON}>
                                    The uploaded data cannot be parsed as valid JSON.
                                </p>
                                <p>Check the file contents or use {NPE_REPO_URL} to generate a new dataset.</p>
                            </>
                        );

                    default:
                        return (
                            <>
                                <p data-testid={TEST_IDS.NPE_PROCESSING_UNHANDLED_ERROR}>
                                    An unknown error has occurred.
                                </p>
                                <p>Please raise an issue at {NPE_REPO_URL} and include the relevant NPE data.</p>
                            </>
                        );
                }
            })()}
        </Callout>
    );
};

export default NPEProcessingStatus;
