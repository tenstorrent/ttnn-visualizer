// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { ReactNode } from 'react';
import { buildGitCommitUrl, formatShortSha } from '../../functions/formatting';

export interface GitCommitInfoProps {
    gitUrl: string | null;
    gitSha: string | null;
}

export interface ReportGitMetadataLinesProps {
    gitUrl: string | null;
    gitSha: string | null;
}

function GitCommitInfo({ gitUrl, gitSha }: GitCommitInfoProps) {
    const shortSha = gitSha ? formatShortSha(gitSha) : null;
    const commitUrl = gitUrl && gitSha ? buildGitCommitUrl(gitUrl, gitSha) : null;

    if (!shortSha) {
        return null;
    }

    return (
        <span className='report-git-info'>
            <strong>Commit:</strong>{' '}
            {commitUrl ? (
                <a
                    href={commitUrl}
                    target='_blank'
                    rel='noreferrer'
                >
                    {shortSha}
                    <Icon
                        icon={IconNames.SHARE}
                        size={10}
                        className='report-git-info-icon'
                    />
                </a>
            ) : (
                shortSha
            )}
        </span>
    );
}

export function ReportGitMetadataLines({ gitUrl, gitSha }: ReportGitMetadataLinesProps): ReactNode {
    return (
        <>
            {gitUrl ? (
                <>
                    <br />
                    <strong>Git repo:</strong> {gitUrl}
                </>
            ) : null}
            {gitSha ? (
                <>
                    <br />
                    <GitCommitInfo
                        gitUrl={gitUrl}
                        gitSha={gitSha}
                    />
                </>
            ) : null}
        </>
    );
}

export default GitCommitInfo;
