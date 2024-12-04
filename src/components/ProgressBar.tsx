// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2024 Tenstorrent Inc.

import { ProgressBar as BlueprintProgressBar } from '@blueprintjs/core';
import 'styles/components/ProgressBar.scss';

interface ProgressBarProps {
    progress?: number;
    estimated?: number;
}

function ProgressBar({ progress, estimated }: ProgressBarProps) {
    return (
        <div className='progress-bar'>
            <BlueprintProgressBar value={progress} />

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
