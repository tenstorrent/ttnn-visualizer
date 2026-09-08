// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { ProgressBar as BlueprintProgressBar } from '@blueprintjs/core';
import 'styles/components/ProgressBar.scss';

interface ProgressBarProps {
    progress?: number;
    ariaLabel?: string;
}

function ProgressBar({ progress, ariaLabel = 'Progress bar' }: ProgressBarProps) {
    return (
        <div className='progress-bar'>
            <BlueprintProgressBar
                value={progress}
                aria-label={ariaLabel}
                animate
            />
        </div>
    );
}

export default ProgressBar;
