// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { Callout, Intent } from '@blueprintjs/core';
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
    matchedVersion?: string;
    expectedVersion: string;
    npeData?: {
        common_info?: {
            version?: string;
        };
    };
}

const NPEProcessingStatus = ({ matchedVersion, expectedVersion, npeData }: NPEProcessingStatusProps) => {
    return (
        <Callout
            intent={Intent.WARNING}
            title={matchedVersion ? 'Invalid NPE version' : 'Invalid NPE data'}
            className='npe-processing-status'
            compact
        >
            {matchedVersion ? (
                <>
                    <p className='status-text'>
                        Current supported version is <u>{expectedVersion}</u>, uploaded data version is{' '}
                        <u>{npeData?.common_info?.version || 'null'}</u>.
                    </p>

                    <p className='status-text'>
                        Use {NPE_REPO_URL} to generate new NPE dataset or install an older version of the visualizer{' '}
                        <code className='formatted-code'>pip install ttnn-visualizer=={matchedVersion}</code>
                    </p>
                </>
            ) : (
                <>
                    <p className='status-text'>Unable to process uploaded NPE data.</p>
                    <p className='status-text'>Use {NPE_REPO_URL} to generate a new dataset.</p>
                </>
            )}
        </Callout>
    );
};

export default NPEProcessingStatus;
