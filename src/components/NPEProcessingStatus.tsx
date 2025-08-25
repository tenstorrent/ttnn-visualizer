/* eslint-disable react/jsx-props-no-spreading */
// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
import { HttpStatusCode } from 'axios';
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
    expectedVersion?: string;
    dataVersion: string | null;
    fetchErrorCode?: HttpStatusCode;
    npeData?: {
        common_info?: {
            version?: string;
        };
    };
    hasUploadedFile?: boolean;
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

const SHARED_PROPS = {
    className: 'npe-processing-status',
    compact: true,
};

const NPEProcessingStatus = ({
    expectedVersion,
    dataVersion,
    fetchErrorCode,
    hasUploadedFile,
}: NPEProcessingStatusProps) => {
    if (!hasUploadedFile) {
        return <Callout {...SHARED_PROPS}>See {NPE_REPO_URL} for details on how to generate NPE report files.</Callout>;
    }

    const legacyVersion = getLegacyNpeVersion(dataVersion);
    const errorType = getErrorType(legacyVersion, fetchErrorCode);

    return (
        <Callout
            {...SHARED_PROPS}
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
                                    <code className='formatted-code'>pip install ttnn-visualizer=={legacyVersion}</code>
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
                                <p className='status-text'>An unknown error has occurred.</p>
                                <p className='status-text'>
                                    Please raise an issue at {NPE_REPO_URL} and include the relevant NPE data.
                                </p>
                            </>
                        );
                }
            })()}
        </Callout>
    );
};

const getErrorType = (legacyVersion: string | null, fetchErrorCode?: HttpStatusCode): ErrorCodes => {
    if (fetchErrorCode === HttpStatusCode.UnprocessableEntity) {
        return ErrorCodes.INVALID_JSON;
    }

    if (legacyVersion) {
        return ErrorCodes.INVALID_NPE_VERSION;
    }

    return ErrorCodes.INVALID_NPE_DATA;
};

const getLegacyNpeVersion = (version: string | null): string | null => {
    const parsedVersion = version ? semverParse(version) : null;

    if (!parsedVersion) {
        return '0.32.3'; // Version of the visualizer that supports pre-version data format
    }

    return null;
};

export default NPEProcessingStatus;
