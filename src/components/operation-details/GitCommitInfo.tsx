// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { buildGitCommitUrl, formatShortSha } from '../../functions/formatting';

export interface GitCommitInfoProps {
    gitUrl: string | null;
    gitSha: string;
}

function GitCommitInfo({ gitUrl, gitSha }: GitCommitInfoProps) {
    const commitUrl = gitUrl ? buildGitCommitUrl(gitUrl, gitSha) : null;
    const shortSha = formatShortSha(gitSha);

    return (
        <span className='stack-trace-git-info'>
            {'Commit: '}
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
                        className='stack-trace-git-info-icon'
                    />
                </a>
            ) : (
                shortSha
            )}
        </span>
    );
}

export default GitCommitInfo;
