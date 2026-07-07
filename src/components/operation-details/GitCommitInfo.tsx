// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Icon } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { buildGitCommitUrl, formatShortSha } from '../../functions/formatting';

export interface GitCommitInfoProps {
    gitUrl?: string | null;
    gitSha?: string | null;
}

function GitCommitInfo({ gitUrl, gitSha }: GitCommitInfoProps) {
    const commitUrl = gitUrl && gitSha ? buildGitCommitUrl(gitUrl, gitSha) : null;
    const shortSha = gitSha ? formatShortSha(gitSha) : null;

    return commitUrl && shortSha ? (
        <span className='stack-trace-git-info'>
            {'Commit: '}
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
        </span>
    ) : null;
}

export default GitCommitInfo;
