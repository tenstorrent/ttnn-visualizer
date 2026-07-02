// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { PopoverPosition, Tooltip } from '@blueprintjs/core';
import 'styles/components/OperationPerfRowBar.scss';
import { perfColorScale } from '../functions/perfOverlay';
import { formatDuration } from '../functions/formatting';
import { OpPerfRowScore } from '../hooks/useOpPerfRowScores';

interface OperationPerfRowBarProps {
    score: OpPerfRowScore | undefined;
}

// Floor so a near-zero `t` still leaves a visible marker instead of vanishing.
const MIN_BAR_PERCENT = 2;

const OperationPerfRowBar = ({ score }: OperationPerfRowBarProps) => {
    if (!score) {
        return null;
    }
    const { deviceTimeNs, t } = score;
    const widthPercent = Math.max(MIN_BAR_PERCENT, Math.round(t * 100));
    const colour = perfColorScale(t);
    const tooltip = `Device kernel duration: ${formatDuration(deviceTimeNs)}`;

    return (
        <Tooltip
            content={tooltip}
            placement={PopoverPosition.TOP}
            hoverOpenDelay={150}
        >
            <div
                className='operation-perf-row-bar'
                role='img'
                aria-label={tooltip}
            >
                <div
                    className='operation-perf-row-bar-fill'
                    style={{ width: `${widthPercent}%`, backgroundColor: colour }}
                />
            </div>
        </Tooltip>
    );
};

export default OperationPerfRowBar;
