// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { AxiosError, HttpStatusCode } from 'axios';
import 'styles/components/NPEProcessingStatus.scss';

const NPE_REPO_URL = (
    <a
        target='_blank'
        href='https://github.com/tenstorrent/tt-npe'
        rel='noreferrer'
    >
        tt-npe
    </a>
);

interface NPEProcessingStatusProps {
    matchedVersion: string | null;
    expectedVersion: string;
    fetchError: AxiosError | null;
    npeData?: {
        common_info?: {
            version?: string;
        };
    };
}

enum ErrorCodes {
    INVALID_NPE_VERSION = 0,
    INVALID_JSON = 1,
    INVALID_NPE_DATA = 2,
}

const PROCESSING_ERRORS = {
    [ErrorCodes.INVALID_NPE_VERSION]: {
        title: 'Invalid NPE version',
    },
    [ErrorCodes.INVALID_JSON]: {
        title: 'Unable to process JSON',
    },
    [ErrorCodes.INVALID_NPE_DATA]: {
        title: 'Invalid NPE data',
    },
};

const NPEProcessingStatus = ({ matchedVersion, expectedVersion, npeData, fetchError }: NPEProcessingStatusProps) => {
    const errorType = getErrorType(fetchError, matchedVersion === expectedVersion);

    return (
        <Callout
            intent={Intent.WARNING}
            title={PROCESSING_ERRORS[errorType].title}
            className='npe-processing-status'
        >
            {(() => {
                switch (errorType) {
                    case ErrorCodes.INVALID_NPE_VERSION:
                        return (
                            <>
                                <p className='status-text'>
                                    Current supported version is <u>{expectedVersion}</u>, uploaded data version is{' '}
                                    <u>{npeData?.common_info?.version || 'null'}</u>.
                                </p>

                                <p className='status-text'>
                                    Use {NPE_REPO_URL} to generate new NPE dataset or install an older version of the
                                    visualizer{' '}
                                    <code className='formatted-code'>
                                        pip install ttnn-visualizer=={matchedVersion}
                                    </code>
                                </p>
                            </>
                        );
                    case ErrorCodes.INVALID_JSON:
                        return (
                            <>
                                <p className='status-text'>The uploaded data cannot be parsed as valid JSON.</p>
                                <p className='status-text'>
                                    Check the file contents or use {NPE_REPO_URL} to generate a new dataset.
                                </p>
                            </>
                        );
                    case ErrorCodes.INVALID_NPE_DATA:
                        return (
                            <>
                                <p className='status-text'>Unable to validate uploaded NPE data.</p>
                                <p className='status-text'>Use {NPE_REPO_URL} to generate a new dataset.</p>
                            </>
                        );
                    default:
                        return null;
                }
            })()}
        </Callout>
    );
};

const getErrorType = (errorData: AxiosError | null, isVersionMatch: boolean): ErrorCodes => {
    if (errorData?.status === HttpStatusCode.UnprocessableEntity) {
        return ErrorCodes.INVALID_JSON;
    }

    if (isVersionMatch) {
        return ErrorCodes.INVALID_NPE_VERSION;
    }

    return ErrorCodes.INVALID_NPE_DATA;
};

export default NPEProcessingStatus;
