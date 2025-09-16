// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ProgressBar as BlueprintProgressBar } from '@blueprintjs/core';
import 'styles/components/ProgressBar.scss';

interface ProgressBarProps {
    progress?: number;
    estimated?: number;
    ariaLabel?: string;
}

function ProgressBar({ progress, estimated, ariaLabel = 'Progress bar' }: ProgressBarProps) {
    return (
        <div className='progress-bar'>
            <BlueprintProgressBar
                value={progress}
                aria-label={ariaLabel}
            />

            {progress && estimated ? (
                <span className='status'>
                    {progress > 0 ? `${Math.round(progress * 100)}%` : `100%`}
                    {` - `}
                    {estimated > 0 ? `${Math.round(estimated)}s left` : '0s left'}
                </span>
            ) : null}
        </div>
    );
}

export default ProgressBar;
