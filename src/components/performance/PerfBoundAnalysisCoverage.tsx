// SPDX-License-Identifier: Apache-2.0
//
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useMemo } from 'react';
import { Callout, Intent } from '@blueprintjs/core';
import { IconNames } from '@blueprintjs/icons';
import { TypedPerfTableRow } from '../../model/PerfTable';
import { NOT_ANALYSED_LABEL, getBoundAnalysisCoverage } from '../../functions/perfBoundAnalysis';
import { formatPercentage } from '../../functions/math';
import { TEST_IDS } from '../../definitions/TestIds';

// Below this share most of the device time is in ops nothing here models, which is when a reader
// is likeliest to read blank DRAM % / FLOPS % columns as "not a bottleneck" (#2048).
const LOW_COVERAGE_PERCENT = 50;

interface PerfBoundAnalysisCoverageProps {
    rows: TypedPerfTableRow[];
}

const PerfBoundAnalysisCoverage = ({ rows }: PerfBoundAnalysisCoverageProps) => {
    const coverage = useMemo(() => getBoundAnalysisCoverage(rows), [rows]);

    if (!coverage) {
        return null;
    }

    const { analysedPercent, fullPercent, flopsOnlyPercent } = coverage;

    return (
        <Callout
            className='bound-analysis-coverage'
            intent={analysedPercent < LOW_COVERAGE_PERCENT ? Intent.WARNING : Intent.PRIMARY}
            icon={IconNames.INFO_SIGN}
            data-testid={TEST_IDS.PERF_BOUND_ANALYSIS_COVERAGE}
            compact
        >
            Bound analysis covers <strong>{formatPercentage(analysedPercent, 1)}</strong> of device time (
            {formatPercentage(fullPercent, 1)} DRAM and FLOPs, {formatPercentage(flopsOnlyPercent, 1)} FLOPs only).
            Cells marked <em>{NOT_ANALYSED_LABEL}</em> were not analysed, which is not the same as not being a
            bottleneck.
        </Callout>
    );
};

export default PerfBoundAnalysisCoverage;
