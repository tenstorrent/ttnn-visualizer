// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { AxiosError, HttpStatusCode } from 'axios';
import 'styles/components/NPEProcessingStatus.scss';
import { semverParse } from '../functions/semverParse';

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
    expectedVersion: string;
    fetchError: AxiosError | null;
    dataVersion: string | null;
}

enum ErrorCodes {
    INVALID_NPE_VERSION,
    INVALID_JSON,
    INVALID_NPE_DATA,
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

const NPEProcessingStatus = ({ expectedVersion, dataVersion, fetchError }: NPEProcessingStatusProps) => {
    const compatibleVersion = getCompatibleNpeDataVersion(dataVersion);
    const errorType = getErrorType(fetchError, compatibleVersion);

    return (
        <Callout
            intent={Intent.WARNING}
            title={PROCESSING_ERRORS?.[errorType]?.title || 'Unknown error'}
            className='npe-processing-status'
        >
            {(() => {
                switch (errorType) {
                    case ErrorCodes.INVALID_NPE_VERSION:
                        return (
                            <>
                                <p className='status-text'>
                                    Current supported version is <u>{expectedVersion}</u>, uploaded data version is{' '}
                                    <u>{dataVersion || 'null'}</u>.
                                </p>

                                <p className='status-text'>
                                    Use {NPE_REPO_URL} to generate new NPE dataset or install an older version of the
                                    visualizer{' '}
                                    <code className='formatted-code'>
                                        pip install ttnn-visualizer=={compatibleVersion}
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
                        return (
                            <>
                                <p className='status-text'>A previously unknown error has occurred.</p>
                                <p className='status-text'>
                                    Please contact the development team by creating an issue at {NPE_REPO_URL} with as
                                    much detail as possible and including the relevant NPE data.
                                </p>
                            </>
                        );
                }
            })()}
        </Callout>
    );
};

const getErrorType = (errorData: AxiosError | null, matchedVersion: string | null): ErrorCodes => {
    if (errorData?.status === HttpStatusCode.UnprocessableEntity) {
        return ErrorCodes.INVALID_JSON;
    }

    if (matchedVersion) {
        return ErrorCodes.INVALID_NPE_VERSION;
    }

    return ErrorCodes.INVALID_NPE_DATA;
};

const getCompatibleNpeDataVersion = (version: string | null): string | null => {
    const parsedVersion = version ? semverParse(version) : null;

    if (!parsedVersion) {
        return '0.32.3'; // Version of the visualizer that supports pre-version data format
    }

    return null;
};

export default NPEProcessingStatus;
