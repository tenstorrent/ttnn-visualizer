// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { Intent, Tag, Tooltip } from '@blueprintjs/core';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { PERF_HEURISTIC_FLAG_DEFINITIONS, PerfHeuristicFlagIntent } from '../../definitions/PerfHeuristics';
import { TEST_IDS } from '../../definitions/TestIds';

const FLAG_INTENT_BY_SEVERITY: Record<PerfHeuristicFlagIntent, Intent> = {
    [PerfHeuristicFlagIntent.WARNING]: Intent.WARNING,
    [PerfHeuristicFlagIntent.DANGER]: Intent.DANGER,
};

interface PerfHeuristicFlagsProps {
    row: TypedPerfTableRow;
}

function PerfHeuristicFlags({ row }: PerfHeuristicFlagsProps) {
    const flags = row.heuristicFlags ?? [];

    if (flags.length === 0) {
        return null;
    }

    return (
        <div
            className='perf-heuristic-flags'
            data-testid={TEST_IDS.PERF_HEURISTIC_FLAGS}
        >
            {flags.map((flag) => {
                const definition = PERF_HEURISTIC_FLAG_DEFINITIONS[flag];
                const detail = row.heuristicFlagDetails?.[flag] ?? null;

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
                            intent={FLAG_INTENT_BY_SEVERITY[definition.intent]}
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
