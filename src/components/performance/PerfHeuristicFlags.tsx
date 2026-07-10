// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Tag, Tooltip } from '@blueprintjs/core';
import { TypedPerfTableRow } from '../../definitions/PerfTable';
import { PerfHeuristicFlag } from '../../definitions/PerfHeuristics';
import { TEST_IDS } from '../../definitions/TestIds';
import {
    PerfHeuristicContext,
    getPerfHeuristicFlagDefinition,
    getPerfHeuristicFlagTooltipDetail,
} from '../../functions/computePerfHeuristicFlags';

interface PerfHeuristicFlagsProps {
    flags: PerfHeuristicFlag[];
    row: TypedPerfTableRow;
    context: PerfHeuristicContext;
}

function PerfHeuristicFlags({ flags, row, context }: PerfHeuristicFlagsProps) {
    if (flags.length === 0) {
        return null;
    }

    return (
        <div
            className='perf-heuristic-flags'
            data-testid={TEST_IDS.PERF_HEURISTIC_FLAGS}
        >
            {flags.map((flag) => {
                const definition = getPerfHeuristicFlagDefinition(flag);
                const detail = getPerfHeuristicFlagTooltipDetail(flag, row, context);

                return (
                    <Tooltip
                        key={flag}
                        content={
                            <div className='perf-heuristic-flag-tooltip'>
                                <strong>{definition.label}</strong>
                                <p>{definition.description}</p>
                                {detail != null && <p className='perf-heuristic-flag-detail'>{detail}</p>}
                            </div>
                        }
                        usePortal={false}
                    >
                        <Tag
                            className='perf-heuristic-flag'
                            data-testid={TEST_IDS.PERF_HEURISTIC_FLAG}
                            data-flag={flag}
                            intent={definition.intent}
                            minimal
                        >
                            {definition.shortLabel}
                        </Tag>
                    </Tooltip>
                );
            })}
        </div>
    );
}

export default PerfHeuristicFlags;
